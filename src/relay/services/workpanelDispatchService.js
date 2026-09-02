import crypto from 'node:crypto';
import { db, writeTx } from '../db.js';
import {
  enqueueRunnerTask,
  findRunnerBindingForRunner,
} from '../runners.js';
import { resolveRoute } from '../routeResolver.js';
import { siteIdFor } from '../directory.js';
import {
  enqueueFederationEnvelope,
  flushFederationOutboxOnce,
} from '../federationSite.js';
import { enqueueHostFederationMessage } from '../federationHost.js';
import { hostRole } from '../hostPeers.js';
import {
  parseGroupRef,
  stableSubjectId,
} from './identityService.js';
import { cancelTask } from './taskQueueService.js';
import { appendAudit } from '../auditLog.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'dead']);
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,200}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function deterministicUuid(value) {
  const bytes = crypto.createHash('sha256').update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function enqueueRemoteEnvelope(config, input) {
  if (hostRole(config) === 'host') return enqueueHostFederationMessage(config, input);
  const envelope = await enqueueFederationEnvelope(config, input);
  await flushFederationOutboxOnce(config).catch(() => {});
  return envelope;
}

function hasScope(service, required) {
  const scopes = new Set(service?.scopes || []);
  return scopes.has('*') || scopes.has('dispatch:*') || scopes.has(required);
}

function isAllowed(list, value) {
  return !Array.isArray(list) || list.length === 0 || list.includes('*') || list.includes(value);
}

function gate(auth, scope, { groupRef, targetSubjectId } = {}) {
  if (auth?.kind !== 'workpanel-service') {
    return { status: 403, body: { error: 'workpanel service token required', code: 'WORKPANEL_SERVICE_REQUIRED' } };
  }
  if (!hasScope(auth.service, scope)) {
    return { status: 403, body: { error: `scope ${scope} required`, code: 'SERVICE_SCOPE_DENIED' } };
  }
  if (groupRef && !isAllowed(auth.service.groupRefs, groupRef)) {
    return { status: 403, body: { error: 'groupRef is outside service scope', code: 'SERVICE_GROUP_DENIED' } };
  }
  if (targetSubjectId && !isAllowed(auth.service.targetSubjectIds, targetSubjectId)) {
    return { status: 403, body: { error: 'targetSubjectId is outside service scope', code: 'SERVICE_TARGET_DENIED' } };
  }
  return null;
}

function parseResult(value, fallbackStatus, resultId = null) {
  if (value == null) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { content: value, phase: fallbackStatus, resultId }; }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      content: Object.prototype.hasOwnProperty.call(parsed, 'content') ? parsed.content : null,
      phase: String(parsed.phase || parsed.status || fallbackStatus),
      resultId: parsed.resultId || resultId || null,
    };
  }
  return { content: parsed, phase: fallbackStatus, resultId };
}

function rowForService(database, serviceId, dispatchId) {
  return database
    .prepare(`SELECT * FROM workpanel_dispatches WHERE id=? AND service_id=?`)
    .get(dispatchId, serviceId);
}

function dispatchDto(row) {
  if (!row) return null;
  let status = row.status;
  let resultJson = row.result_json;
  let resultId = null;
  let lastError = row.last_error;
  let completedAt = row.completed_at;
  if (row.task_id && row.target_site === row.local_site_id) {
    const task = db().prepare(`SELECT status,result_json,result_id,last_error,completed_at FROM runner_tasks WHERE id=?`).get(row.task_id);
    if (task) {
      status = task.status;
      resultJson = task.result_json;
      resultId = task.result_id;
      lastError = task.last_error;
      completedAt = task.completed_at;
    }
  }
  return {
    dispatchId: row.id,
    status,
    groupRef: row.group_ref,
    targetSubjectId: row.target_subject_id,
    targetSite: row.target_site,
    traceId: row.trace_id,
    taskId: row.task_id || null,
    writeBack: false,
    result: parseResult(resultJson, status, resultId),
    error: lastError || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: completedAt || null,
  };
}

function readDispatch(serviceId, dispatchId, localSiteId) {
  const row = rowForService(db(), serviceId, dispatchId);
  return row ? dispatchDto({ ...row, local_site_id: localSiteId }) : null;
}

function reserveDispatch({ serviceId, idempotencyKey, requestHash, dispatchId, groupRef, targetSubjectId, targetSite, traceId, localSiteId }) {
  return writeTx((database) => {
    const inserted = database.prepare(
      `INSERT INTO workpanel_dispatches
       (id,service_id,idempotency_key,request_hash,group_ref,target_subject_id,target_site,trace_id,status)
       VALUES (?,?,?,?,?,?,?,?,'preparing')
       ON CONFLICT(service_id,idempotency_key) DO NOTHING`
    ).run(dispatchId, serviceId, idempotencyKey, requestHash, groupRef, targetSubjectId, targetSite, traceId);
    const row = database.prepare(
      `SELECT * FROM workpanel_dispatches WHERE service_id=? AND idempotency_key=?`
    ).get(serviceId, idempotencyKey);
    if (row.request_hash !== requestHash) {
      return { conflict: true, row: { ...row, local_site_id: localSiteId } };
    }
    return { conflict: false, existing: inserted.changes === 0, row: { ...row, local_site_id: localSiteId } };
  });
}

async function updateDispatch(dispatchId, fields) {
  const names = Object.keys(fields);
  if (!names.length) return;
  await writeTx((database) => database.prepare(
    `UPDATE workpanel_dispatches SET ${names.map((name) => `${name}=?`).join(',')},updated_at=datetime('now') WHERE id=?`
  ).run(...names.map((name) => fields[name]), dispatchId));
}

export async function createWorkpanelDispatch(config, auth, body = {}, { idempotencyKey } = {}) {
  const prompt = body.prompt ?? body.content;
  if (!prompt || !String(prompt).trim()) {
    return { status: 400, body: { error: 'prompt required', code: 'PROMPT_REQUIRED' } };
  }
  if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(String(idempotencyKey))) {
    return { status: 400, body: { error: 'valid Idempotency-Key required', code: 'IDEMPOTENCY_KEY_REQUIRED' } };
  }
  if (body.writeBack === true) {
    return { status: 400, body: { error: 'provider dispatch requires writeBack=false', code: 'WRITEBACK_FORBIDDEN' } };
  }
  const groupRef = String(body.groupRef || '').trim();
  const targetSubjectId = String(body.targetSubjectId || '').trim();
  let parsedGroup;
  try { parsedGroup = parseGroupRef(groupRef); } catch {
    return { status: 400, body: { error: 'valid groupRef required', code: 'GROUP_REF_INVALID' } };
  }
  if (!targetSubjectId) {
    return { status: 400, body: { error: 'targetSubjectId required', code: 'TARGET_SUBJECT_REQUIRED' } };
  }
  const denied = gate(auth, 'dispatch:create', { groupRef, targetSubjectId });
  if (denied) return denied;
  const env = String(body.env || config?.defaults?.env || '').trim();
  if (!env) return { status: 400, body: { error: 'env required', code: 'ENV_REQUIRED' } };
  const requiredCapabilities = Array.isArray(body.requiredCapabilities)
    ? [...new Set(body.requiredCapabilities.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]
    : [];
  const localSiteId = siteIdFor(config);
  const dispatchId = deterministicUuid(`workpanel-dispatch/${auth.service.id}/${idempotencyKey}`);
  const traceId = deterministicUuid(`workpanel-dispatch-trace/${auth.service.id}/${idempotencyKey}`);
  const requestHash = hash({ groupRef, targetSubjectId, env, prompt: String(prompt), requiredCapabilities, context: body.context || null, writeBack: false });
  const prior = db().prepare(
    `SELECT * FROM workpanel_dispatches WHERE service_id=? AND idempotency_key=?`
  ).get(auth.service.id, String(idempotencyKey));
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return { status: 409, body: { error: 'Idempotency-Key payload conflict', code: 'IDEMPOTENCY_CONFLICT' } };
    }
    if (prior.status !== 'preparing') {
      return { status: 200, body: { ...dispatchDto({ ...prior, local_site_id: localSiteId }), idempotent: true } };
    }
  }
  const route = resolveRoute({ groupRef, targetSubjectId, requiredCapabilities, sourceSiteId: localSiteId, traceId });
  if (!route.target) {
    const unavailable = route.reason === 'NO_ONLINE_ENDPOINT' || route.reason === 'NO_ELIGIBLE_ENDPOINT';
    return { status: unavailable ? 503 : 404, body: { error: 'eligible target unavailable', code: route.reason, traceId } };
  }
  const reserved = await reserveDispatch({
    serviceId: auth.service.id, idempotencyKey: String(idempotencyKey), requestHash,
    dispatchId, groupRef, targetSubjectId, targetSite: route.target.siteId, traceId, localSiteId,
  });
  if (reserved.conflict) {
    return { status: 409, body: { error: 'Idempotency-Key payload conflict', code: 'IDEMPOTENCY_CONFLICT' } };
  }
  if (reserved.existing && reserved.row.status !== 'preparing') {
    return { status: 200, body: { ...dispatchDto(reserved.row), idempotent: true } };
  }

  const context = {
    ...(body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {}),
    source: 'workpanel-service',
    providerServiceId: auth.service.id,
    dispatchId,
    traceId,
    correlationId: dispatchId,
    requiredCapabilities,
    writeBack: false,
  };
  try {
    if (route.target.siteId === localSiteId) {
      const binding = findRunnerBindingForRunner({
        runnerId: route.target.localId,
        env,
        groupId: parsedGroup.groupId,
        agentName: route.target.displayName,
      });
      if (!binding) {
        await updateDispatch(dispatchId, { status: 'failed', last_error: 'local runner binding unavailable', completed_at: new Date().toISOString() });
        return { status: 503, body: { error: 'local runner binding unavailable', code: 'RUNNER_BINDING_UNAVAILABLE', traceId } };
      }
      const task = await enqueueRunnerTask({
        config, taskId: dispatchId, runnerId: binding.runner_id, channelId: binding.channel_id,
        env, groupId: parsedGroup.groupId, groupName: body.groupName || parsedGroup.groupId,
        agentName: route.target.displayName, content: String(prompt), context,
      });
      await updateDispatch(dispatchId, { task_id: task.id, status: task.status });
    } else {
      if (config?.federation?.enabled === false) {
        await updateDispatch(dispatchId, { status: 'failed', last_error: 'federation disabled', completed_at: new Date().toISOString() });
        return { status: 503, body: { error: 'federation disabled', code: 'FEDERATION_DISABLED', traceId } };
      }
      const envelope = await enqueueRemoteEnvelope(config, {
        messageId: deterministicUuid(`workpanel-dispatch-message/${dispatchId}`),
        targetSite: route.target.siteId,
        groupRef,
        fromSubject: stableSubjectId({ siteId: localSiteId, kind: 'service', localId: auth.service.id }),
        toSubject: targetSubjectId,
        kind: 'chat.command',
        correlationId: dispatchId,
        traceId,
        payload: {
          env,
          groupName: body.groupName || parsedGroup.groupId,
          agentName: route.target.displayName,
          content: String(prompt),
          requiredCapabilities,
          writeBack: false,
          context,
        },
      });
      await updateDispatch(dispatchId, { federation_message_id: envelope.messageId, status: 'federating' });
    }
  } catch (error) {
    await updateDispatch(dispatchId, { status: 'failed', last_error: String(error.message || error), completed_at: new Date().toISOString() });
    return { status: 503, body: { error: 'dispatch enqueue failed', code: 'DISPATCH_ENQUEUE_FAILED', traceId } };
  }
  appendAudit({ eventType: 'workpanel.dispatch', outcome: 'allow', actor: `workpanel-service:${auth.service.id}`,
    siteId: localSiteId, subjectId: targetSubjectId, traceId, correlationId: dispatchId, taskId: dispatchId,
    detail: { groupRef, targetSite: route.target.siteId, writeBack: false } });
  return { status: 202, body: readDispatch(auth.service.id, dispatchId, localSiteId) };
}

export function getWorkpanelDispatch(config, auth, dispatchId) {
  const denied = gate(auth, 'dispatch:read');
  if (denied) return denied;
  const row = readDispatch(auth.service.id, dispatchId, siteIdFor(config));
  if (!row) return { status: 404, body: { error: 'dispatch not found', code: 'DISPATCH_NOT_FOUND' } };
  const scoped = gate(auth, 'dispatch:read', { groupRef: row.groupRef, targetSubjectId: row.targetSubjectId });
  return scoped || { status: 200, body: row };
}

export async function cancelWorkpanelDispatch(config, auth, dispatchId, body = {}) {
  const denied = gate(auth, 'dispatch:cancel');
  if (denied) return denied;
  const current = readDispatch(auth.service.id, dispatchId, siteIdFor(config));
  if (!current) return { status: 404, body: { error: 'dispatch not found', code: 'DISPATCH_NOT_FOUND' } };
  const scoped = gate(auth, 'dispatch:cancel', { groupRef: current.groupRef, targetSubjectId: current.targetSubjectId });
  if (scoped) return scoped;
  if (TERMINAL.has(current.status)) {
    if (current.status === 'cancelled') return { status: 200, body: { ...current, idempotent: true } };
    return { status: 409, body: { error: `dispatch already ${current.status}`, code: 'DISPATCH_TERMINAL' } };
  }
  const localSiteId = siteIdFor(config);
  const reason = String(body.reason || 'cancelled by WorkPanel provider');
  if (current.targetSite === localSiteId) {
    const result = await cancelTask(current.taskId || dispatchId, { actor: `workpanel-service:${auth.service.id}`, reason });
    if (result.status !== 200) return result;
    await updateDispatch(dispatchId, { status: 'cancelled', completed_at: new Date().toISOString(), last_error: reason });
  } else {
    const envelope = await enqueueRemoteEnvelope(config, {
      messageId: deterministicUuid(`workpanel-dispatch-cancel/${dispatchId}`),
      targetSite: current.targetSite,
      groupRef: current.groupRef,
      fromSubject: stableSubjectId({ siteId: localSiteId, kind: 'service', localId: auth.service.id }),
      toSubject: current.targetSubjectId,
      kind: 'run.cancel',
      correlationId: dispatchId,
      causationId: db().prepare(`SELECT federation_message_id FROM workpanel_dispatches WHERE id=?`).get(dispatchId)?.federation_message_id || null,
      traceId: current.traceId,
      payload: { reason, writeBack: false },
    });
    await updateDispatch(dispatchId, { status: 'cancel_requested', federation_message_id: envelope.messageId });
  }
  appendAudit({ eventType: 'workpanel.dispatch_cancel', outcome: 'allow', actor: `workpanel-service:${auth.service.id}`,
    siteId: localSiteId, subjectId: current.targetSubjectId, traceId: current.traceId, correlationId: dispatchId,
    taskId: current.taskId || dispatchId, detail: { targetSite: current.targetSite } });
  return { status: 202, body: readDispatch(auth.service.id, dispatchId, localSiteId) };
}
