import { createHash, randomUUID } from 'node:crypto';
import { db, getMessageById, insertDeliveryLog, insertMessageOrGet, updateMessageStatus, upsertRun, writeTx } from './db.js';
import { createFederationEnvelope } from './contracts/federation.js';
import { siteIdFor, listLocalFederationRoutes, importFederationRoutes } from './directory.js';
import { parseGroupRef, stableSubjectId } from './services/identityService.js';
import { resolveRoute } from './routeResolver.js';
import { enqueueRunnerTask, findRunnerBindingForRunner } from './runners.js';
import { makeEnvelope } from './messaging.js';
import { signFederationEnvelope, siteSigningKey } from './envelopeSignature.js';
import { authorizeFederation } from './accessPolicy.js';
import { appendAudit } from './auditLog.js';
import { recordTelemetry } from './telemetry.js';
import { postAsAgent } from '../workpanelClient.js';
import { federationHostRequest as request } from './federationClient.js';
import { cancelTask } from './services/taskQueueService.js';
import { completeWorkpanelDispatchFromFederation } from './services/workpanelDispatchProjection.js';

export function enqueueFederationEnvelope(config, input) {
  const unsigned = createFederationEnvelope({ originSite: siteIdFor(config), ...input });
  const policy = authorizeFederation(config, { originSite: unsigned.originSite, targetSite: unsigned.targetSite,
    groupRef: unsigned.groupRef, subjectId: unsigned.toSubject, operation: unsigned.kind, direction: 'outbound',
    capabilities: unsigned.payload?.requiredCapabilities || unsigned.payload?.capability,
    dataClassification: unsigned.payload?.dataClassification || 'internal' });
  if (!policy.allowed) {
    appendAudit({ eventType: 'federation.policy', outcome: 'deny', actor: unsigned.fromSubject, siteId: unsigned.originSite,
      subjectId: unsigned.toSubject, traceId: unsigned.traceId, correlationId: unsigned.correlationId,
      messageId: unsigned.messageId, policyVersion: policy.policyVersion, detail: { reason: policy.reason } });
    const error = new Error('federation policy denied'); error.code = 'FEDERATION_DENIED'; throw error;
  }
  const envelope = config?.federation?.requireSignatures === false ? unsigned : signFederationEnvelope(unsigned, siteSigningKey(config));
  return writeTx((database) => {
    database.prepare(
      `INSERT INTO federation_outbox (id,origin_site,message_id,target_site,envelope_json,status,available_at)
       VALUES (?, ?, ?, ?, ?, 'queued', datetime('now')) ON CONFLICT(origin_site,message_id) DO NOTHING`
    ).run(`fout_${envelope.originSite}_${envelope.messageId}`, envelope.originSite, envelope.messageId, envelope.targetSite, JSON.stringify(envelope));
    return envelope;
  }).then((stored) => {
    recordTelemetry({ eventName: 'federation.site.enqueue', siteId: stored.originSite, traceId: stored.traceId,
      correlationId: stored.correlationId, messageId: stored.messageId, subjectId: stored.toSubject,
      detail: { targetSite: stored.targetSite, kind: stored.kind } });
    return stored;
  });
}

export async function flushFederationOutboxOnce(config, limit = 50) {
  const rows = db().prepare(
    `SELECT * FROM federation_outbox WHERE status IN ('queued','retry','accepted') AND (available_at IS NULL OR available_at<=datetime('now')) ORDER BY created_at LIMIT ?`
  ).all(Math.min(Math.max(Number(limit) || 50, 1), 100));
  let sent = 0;
  for (const row of rows) {
    const envelope = JSON.parse(row.envelope_json);
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      await writeTx((database) => database.prepare(`UPDATE federation_outbox SET status='expired',last_error='envelope_expired',available_at=NULL,updated_at=datetime('now') WHERE id=?`).run(row.id));
      continue;
    }
    try {
      const accepted = await request(config, '/v1/federation/messages', { body: envelope });
      const terminal = ['delivered', 'failed', 'expired', 'dead'].includes(accepted.status);
      const reconcileSec = Math.min(Math.max(Number(config?.federation?.reconcileSec) || 30, 1), 3600);
      await writeTx((database) => database.prepare(
        `UPDATE federation_outbox SET status=?,attempt=attempt+1,last_error=NULL,
         available_at=CASE WHEN ? THEN NULL ELSE datetime('now', ?) END,updated_at=datetime('now') WHERE id=?`
      ).run(terminal ? accepted.status : 'accepted', terminal ? 1 : 0, `+${reconcileSec} seconds`, row.id));
      sent += 1;
    } catch (error) {
      const maxOutboxAttempts = Math.min(Math.max(Number(config?.federation?.outboxMaxAttempts) || 100, 1), 10000);
      const dead = Number(row.attempt || 0) + 1 >= maxOutboxAttempts;
      await writeTx((database) => database.prepare(
        `UPDATE federation_outbox SET status=?,attempt=attempt+1,last_error=?,
         available_at=CASE WHEN ? THEN NULL ELSE datetime('now', ?) END,updated_at=datetime('now') WHERE id=?`
      ).run(dead ? 'dead' : 'retry', String(error.message || error), dead ? 1 : 0,
        `+${Math.min(60, 2 ** Math.min(row.attempt + 1, 6))} seconds`, row.id));
    }
  }
  return { sent, attempted: rows.length };
}

export async function syncFederationDirectoryOnce(config) {
  const routes = listLocalFederationRoutes(config);
  await request(config, '/v1/federation/directory/advertise', { body: { routes, ttlSec: 90 } });
  const remote = await request(config, '/v1/federation/directory', { method: 'GET' });
  await importFederationRoutes(config, remote.routes || [], 90);
  return { advertised: routes.length, imported: (remote.routes || []).length };
}

async function processChatCommand(config, envelope) {
  const route = resolveRoute({ groupRef: envelope.groupRef, targetSubjectId: envelope.toSubject, sourceSiteId: siteIdFor(config) });
  if (!route.target || route.target.siteId !== siteIdFor(config)) throw new Error('local federation target unavailable');
  const parsed = parseGroupRef(envelope.groupRef);
  const binding = findRunnerBindingForRunner({ runnerId: route.target.localId, env: envelope.payload.env, groupId: parsed.groupId, agentName: route.target.displayName });
  if (!binding) throw new Error('local runner binding unavailable');
  const task = await enqueueRunnerTask({
    config, taskId: `fedtask_${envelope.originSite}_${envelope.messageId}`,
    runnerId: binding.runner_id, channelId: binding.channel_id, env: envelope.payload.env,
    groupId: parsed.groupId, groupName: envelope.payload.groupName || parsed.groupId,
    agentName: route.target.displayName, content: envelope.payload.content,
    context: { ...(envelope.payload.context || {}), federation: { originSite: envelope.originSite, messageId: envelope.messageId, correlationId: envelope.correlationId, traceId: envelope.traceId, fromSubject: envelope.fromSubject, originalMessageId: envelope.payload.originalMessageId } },
    federation: { originSite: envelope.originSite, messageId: envelope.messageId, correlationId: envelope.correlationId },
  });
  return { taskId: task.id };
}

async function processRunEvent(config, envelope) {
  const originalId = String(envelope.payload.originalMessageId || '');
  const projection = await writeTx((database) => {
    const up = getMessageById(database, originalId);
    if (!up) {
      const provider = completeWorkpanelDispatchFromFederation(database, envelope);
      if (provider) return { ...provider, provider: true };
      throw new Error('origin message unavailable');
    }
    const status = ['completed', 'failed', 'cancelled'].includes(envelope.payload.status)
      ? envelope.payload.status
      : 'failed';
    const payloadHash = createHash('sha256').update(JSON.stringify(envelope.payload || {})).digest('hex');
    const prior = database.prepare(`SELECT * FROM federation_run_terminals WHERE correlation_id=?`).get(envelope.correlationId);
    if (prior) {
      const conflict = prior.status !== status || prior.payload_hash !== payloadHash;
      if (conflict) appendAudit({ eventType: 'federation.terminal_conflict', outcome: 'deny', actor: envelope.originSite,
        siteId: envelope.targetSite, traceId: envelope.traceId, correlationId: envelope.correlationId,
        messageId: envelope.messageId, detail: { effectiveMessageId: prior.message_id, effectiveStatus: prior.status } });
      return { originalMessageId: originalId, status: prior.status, duplicate: !conflict, conflict };
    }
    database.prepare(
      `INSERT INTO federation_run_terminals (correlation_id,message_id,origin_site,status,payload_hash) VALUES (?, ?, ?, ?, ?)`
    ).run(envelope.correlationId, envelope.messageId, envelope.originSite, status, payloadHash);
    updateMessageStatus(database, up.id, status === 'completed' ? 'delivered' : 'failed', null);
    const upEnv = JSON.parse(up.envelope_json);
    const down = makeEnvelope({ id: `msg_${envelope.messageId}`, direction: 'down', conversation: upEnv.conversation.replace(/^grp_/, ''),
      from: { kind: 'agent', id: upEnv.to.id }, to: { kind: 'pet', id: upEnv.from.id }, content: String(envelope.payload.content ?? ''), ack: status });
    insertMessageOrGet(database, { id: down.id, agent_instance_id: up.agent_instance_id, direction: 'down', envelope_json: JSON.stringify(down), status: status === 'completed' ? 'delivered' : 'failed', retries: 0 });
    upsertRun(database, { id: envelope.correlationId, message_id: up.id, agent_instance_id: up.agent_instance_id, status,
      detail_json: JSON.stringify({ ...envelope.payload, remoteTaskId: envelope.payload.taskId }) });
    const instance = database.prepare(`SELECT env,group_id,agent_name FROM agent_instances WHERE id=?`).get(up.agent_instance_id);
    return { originalMessageId: originalId, status, writeback: instance ? {
      env: instance.env, groupId: instance.group_id, agentName: instance.agent_name, messageId: up.id,
    } : null };
  });
  if (!projection.writeback || projection.duplicate || projection.conflict || envelope.payload.writeBack === false) return projection;
  const backend = config?.backends?.[projection.writeback.env];
  let writeBackResult = { ok: false, status: 503, error: `no workpanel backend for env ${projection.writeback.env}` };
  if (backend?.kind === 'workpanel') {
    try {
      writeBackResult = await postAsAgent({ kind: 'workpanel', baseUrl: backend.baseUrl, auth: backend.auth || {} }, {
        groupId: projection.writeback.groupId, agentName: projection.writeback.agentName,
        content: String(envelope.payload.content ?? ''),
      });
    } catch (error) {
      writeBackResult = { ok: false, status: 502, error: String(error.message || error) };
    }
  }
  await writeTx((database) => insertDeliveryLog(database, {
    message_id: projection.writeback.messageId, target: 'workpanel:federation-result', attempt: 1,
    result: writeBackResult.ok ? 'delivered' : `dead:${writeBackResult.error || writeBackResult.status}`,
  }));
  appendAudit({ eventType: 'federation.workpanel_writeback', outcome: writeBackResult.ok ? 'allow' : 'failed',
    actor: envelope.originSite, siteId: envelope.targetSite, traceId: envelope.traceId,
    correlationId: envelope.correlationId, messageId: envelope.messageId,
    detail: { status: writeBackResult.status, error: writeBackResult.error } });
  recordTelemetry({ level: writeBackResult.ok ? 'info' : 'warn', eventName: 'federation.workpanel_writeback',
    siteId: envelope.targetSite, traceId: envelope.traceId, correlationId: envelope.correlationId,
    messageId: envelope.messageId, detail: { ok: writeBackResult.ok, status: writeBackResult.status } });
  return { ...projection, writeBack: { ok: writeBackResult.ok, status: writeBackResult.status } };
}

async function processRunCancel(config, envelope) {
  const task = db().prepare(
    `SELECT * FROM runner_tasks WHERE federation_origin_site=? AND federation_correlation_id=? ORDER BY created_at DESC LIMIT 1`
  ).get(envelope.originSite, envelope.correlationId);
  if (!task) throw new Error('federated task unavailable');
  const cancelled = await cancelTask(task.id, {
    actor: `federation:${envelope.originSite}`,
    reason: envelope.payload?.reason || 'cancelled by origin provider',
  });
  if (cancelled.status !== 200) {
    if (cancelled.body?.code === 'TASK_TERMINAL') return { taskId: task.id, status: task.status, terminal: true };
    throw new Error(cancelled.body?.error || 'federated cancellation failed');
  }
  const updated = db().prepare(`SELECT * FROM runner_tasks WHERE id=?`).get(task.id);
  await enqueueFederationRunEvent(config, updated, { status: 'cancelled', content: null });
  await flushFederationOutboxOnce(config).catch(() => {});
  return { taskId: task.id, status: 'cancelled' };
}

async function processInboxEnvelope(config, envelope) {
  const policy = authorizeFederation(config, { originSite: envelope.originSite, targetSite: envelope.targetSite,
    groupRef: envelope.groupRef, subjectId: envelope.toSubject, operation: envelope.kind, direction: 'inbound',
    capabilities: envelope.payload?.requiredCapabilities || envelope.payload?.capability,
    dataClassification: envelope.payload?.dataClassification || 'internal' });
  if (!policy.allowed) {
    appendAudit({ eventType: 'federation.policy', outcome: 'deny', actor: envelope.originSite, siteId: siteIdFor(config),
      subjectId: envelope.toSubject, traceId: envelope.traceId, correlationId: envelope.correlationId,
      messageId: envelope.messageId, policyVersion: policy.policyVersion, detail: { reason: policy.reason, direction: 'inbound' } });
    throw new Error('inbound federation policy denied');
  }
  if (envelope.kind === 'chat.command') return processChatCommand(config, envelope);
  if (envelope.kind === 'run.event') return processRunEvent(config, envelope);
  if (envelope.kind === 'run.cancel') return processRunCancel(config, envelope);
  return { ignored: true };
}

export async function pullFederationInboxOnce(config, { limit = 20, waitMs = 0 } = {}) {
  const pulled = await request(config, '/v1/federation/pull', { body: { limit, waitMs }, timeoutMs: Math.max(8000, Number(waitMs) + 3000) });
  const configuredMax = Math.min(Math.max(Number(config?.federation?.inboxMaxAttempts) || 10, 1), 1000);
  for (const item of pulled.messages || []) {
    const envelope = item.envelope;
    await writeTx((database) => database.prepare(
      `INSERT INTO federation_inbox
       (id,origin_site,message_id,host_lease_token,envelope_json,status,max_attempts,available_at)
       VALUES (?, ?, ?, ?, ?, 'received', ?, datetime('now'))
       ON CONFLICT(origin_site,message_id) DO UPDATE SET host_lease_token=excluded.host_lease_token,
         completion_error=NULL`
    ).run(`fin_${envelope.originSite}_${envelope.messageId}`, envelope.originSite, envelope.messageId,
      item.leaseToken, JSON.stringify(envelope), configuredMax));
    try {
      await request(config, '/v1/federation/ack', { body: { originSite: envelope.originSite, messageId: envelope.messageId, leaseToken: item.leaseToken } });
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status=CASE WHEN status='awaiting_ack' THEN 'received' ELSE status END,
         completion_error=NULL WHERE origin_site=? AND message_id=?`
      ).run(envelope.originSite, envelope.messageId));
    } catch (error) {
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status='awaiting_ack',completion_error=?
         WHERE origin_site=? AND message_id=? AND status IN ('received','awaiting_ack')`
      ).run(`ack: ${String(error.message || error)}`, envelope.originSite, envelope.messageId));
    }
  }
  const acknowledgements = await reconcileFederationAcknowledgementsOnce(config, { limit: Math.max(limit, 20) });
  const consumed = await processFederationInboxOnce(config, { limit: Math.max(limit, 20) });
  const completed = await reconcileFederationInboxOnce(config, { limit: Math.max(limit, 20) });
  return { pulled: (pulled.messages || []).length, acknowledged: acknowledgements.acknowledged,
    processed: consumed.processed, retried: consumed.retried, completed: completed.completed };
}

export async function reconcileFederationAcknowledgementsOnce(config, { limit = 50 } = {}) {
  const rows = db().prepare(
    `SELECT * FROM federation_inbox WHERE status='awaiting_ack' AND host_lease_token IS NOT NULL ORDER BY received_at LIMIT ?`
  ).all(Math.min(Math.max(Number(limit) || 50, 1), 500));
  let acknowledged = 0;
  for (const row of rows) {
    try {
      await request(config, '/v1/federation/ack', { body: {
        originSite: row.origin_site, messageId: row.message_id, leaseToken: row.host_lease_token,
      } });
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status='received',completion_error=NULL WHERE id=? AND status='awaiting_ack'`
      ).run(row.id));
      acknowledged += 1;
    } catch (error) {
      await writeTx((database) => database.prepare(`UPDATE federation_inbox SET completion_error=? WHERE id=?`)
        .run(`ack: ${String(error.message || error)}`, row.id));
    }
  }
  return { acknowledged };
}

function claimInboxRow(config) {
  return writeTx((database) => {
    database.prepare(
      `UPDATE federation_inbox SET status='retry',available_at=datetime('now'),last_error=COALESCE(last_error,'consumer lease expired')
       WHERE status='processing' AND available_at<=datetime('now')`
    ).run();
    const row = database.prepare(
      `SELECT * FROM federation_inbox WHERE status IN ('received','retry')
       AND (available_at IS NULL OR available_at<=datetime('now')) ORDER BY received_at LIMIT 1`
    ).get();
    if (!row) return null;
    const leaseSec = Math.min(Math.max(Number(config?.federation?.inboxProcessingLeaseSec) || 60, 5), 3600);
    const claimed = database.prepare(
      `UPDATE federation_inbox SET status='processing',attempt=attempt+1,available_at=datetime('now', ?)
       WHERE id=? AND status IN ('received','retry')`
    ).run(`+${leaseSec} seconds`, row.id);
    return claimed.changes === 1 ? { ...row, attempt: Number(row.attempt || 0) + 1 } : null;
  });
}

export async function processFederationInboxOnce(config, { limit = 50 } = {}) {
  let processed = 0;
  let retried = 0;
  const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
  for (let index = 0; index < max; index += 1) {
    const row = await claimInboxRow(config);
    if (!row) break;
    const envelope = JSON.parse(row.envelope_json);
    try {
      await processInboxEnvelope(config, envelope);
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status='processed',processed_at=datetime('now'),available_at=NULL,
         last_error=NULL,completion_error=NULL WHERE id=?`
      ).run(row.id));
      recordTelemetry({ eventName: 'federation.site.processed', siteId: siteIdFor(config), traceId: envelope.traceId,
        correlationId: envelope.correlationId, messageId: envelope.messageId, subjectId: envelope.toSubject,
        detail: { kind: envelope.kind, attempt: row.attempt } });
      processed += 1;
    } catch (error) {
      const dead = row.attempt >= Number(row.max_attempts || 10);
      const delay = Math.min(300, 2 ** Math.min(row.attempt, 8));
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status=?,last_error=?,
         available_at=CASE WHEN ? THEN NULL ELSE datetime('now', ?) END WHERE id=?`
      ).run(dead ? 'dead' : 'retry', String(error.message || error), dead ? 1 : 0, `+${delay} seconds`, row.id));
      appendAudit({ eventType: 'federation.inbox_process', outcome: dead ? 'dead' : 'retry', actor: envelope.originSite,
        siteId: siteIdFor(config), subjectId: envelope.toSubject, traceId: envelope.traceId,
        correlationId: envelope.correlationId, messageId: envelope.messageId,
        detail: { attempt: row.attempt, error: String(error.message || error) } });
      retried += 1;
    }
  }
  return { processed, retried };
}

export async function reconcileFederationInboxOnce(config, { limit = 50 } = {}) {
  const rows = db().prepare(
    `SELECT * FROM federation_inbox WHERE status IN ('processed','dead') AND host_lease_token IS NOT NULL
     ORDER BY received_at LIMIT ?`
  ).all(Math.min(Math.max(Number(limit) || 50, 1), 500));
  let completed = 0;
  for (const row of rows) {
    const delivered = row.status === 'processed';
    try {
      await request(config, '/v1/federation/result', { body: {
        originSite: row.origin_site, messageId: row.message_id, leaseToken: row.host_lease_token,
        status: delivered ? 'delivered' : 'failed', error: delivered ? undefined : row.last_error,
      } });
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET status=?,completion_error=NULL WHERE id=?`
      ).run(delivered ? 'delivered' : 'failed', row.id));
      completed += 1;
    } catch (error) {
      await writeTx((database) => database.prepare(
        `UPDATE federation_inbox SET completion_error=? WHERE id=?`
      ).run(String(error.message || error), row.id));
    }
  }
  return { completed };
}

export async function enqueueFederationRunEvent(config, task, body) {
  if (!task?.federation_origin_site) return null;
  const context = task.context_json ? JSON.parse(task.context_json) : {};
  const fed = context.federation || {};
  return enqueueFederationEnvelope(config, {
    targetSite: task.federation_origin_site, groupRef: `wp:${task.federation_origin_site}:${encodeURIComponent(task.group_id)}`,
    fromSubject: stableSubjectId({ siteId: siteIdFor(config), kind: 'agent', localId: task.runner_id }),
    toSubject: fed.fromSubject, kind: 'run.event', correlationId: task.federation_correlation_id,
    causationId: task.federation_message_id, traceId: fed.traceId,
    payload: { taskId: task.id, originalMessageId: fed.originalMessageId, status: body.status, content: body.content, writeBack: context.writeBack !== false },
  });
}


export function listFederationOutbox({ status, limit = 100 } = {}) {
  let sql = `SELECT id,origin_site,message_id,target_site,status,attempt,available_at,last_error,created_at,updated_at FROM federation_outbox`;
  const params = [];
  if (status) { sql += ' WHERE status=?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ?'; params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return db().prepare(sql).all(...params);
}

export function requeueFederationOutbox(id) {
  return writeTx((database) => {
    const result = database.prepare(
      `UPDATE federation_outbox SET status='queued',attempt=0,available_at=datetime('now'),last_error=NULL,updated_at=datetime('now')
       WHERE id=? AND status IN ('dead','failed')`
    ).run(id);
    return result.changes === 1
      ? { status: 200, body: { ok: true, id, status: 'queued' } }
      : { status: 404, body: { error: 'requeueable federation outbox entry not found' } };
  });
}

export function federationBacklogState() {
  const database = db();
  return {
    outboxBacklog: Number(database.prepare(
      `SELECT COUNT(*) n FROM federation_outbox WHERE status IN ('queued','retry','accepted')`
    ).get().n || 0),
    inboxBacklog: Number(database.prepare(
      `SELECT COUNT(*) n FROM federation_inbox WHERE status IN ('awaiting_ack','received','processing','retry','processed','dead')`
    ).get().n || 0),
  };
}
