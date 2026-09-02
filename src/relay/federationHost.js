import { randomUUID } from 'node:crypto';
import { db, writeTx } from './db.js';
import { hashToken } from './registry.js';
import { createFederationEnvelope, validateFederationEnvelope } from './contracts/federation.js';
import { hostRole, provisionedHostPeer } from './hostPeers.js';
import { siteIdFor } from './directory.js';
import { hasOnlyExternalSigningKeys, peerVerificationKeys, signFederationEnvelope, verifyFederationEnvelopeSignature } from './envelopeSignature.js';
import { authorizeFederation } from './accessPolicy.js';
import { appendAudit } from './auditLog.js';
import { checkFederationQuota } from './quotas.js';
import { parseGroupRef, stableSubjectId } from './services/identityService.js';
import { recordTelemetry } from './telemetry.js';
import { completeWorkpanelDispatchFromFederation } from './services/workpanelDispatchProjection.js';

const activePulls = new Map();

function leaseSec(config) {
  const n = Number(config?.federation?.leaseSec);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 600) : 30;
}

function maxAttempts(config) {
  const n = Number(config?.federation?.maxAttempts);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 5;
}

function assertHost(config) {
  if (hostRole(config) !== 'host') {
    return { status: 403, body: { error: 'this process is not Connecter Host', code: 'NOT_HOST' } };
  }
  if (config?.federation?.enabled === false) return { status: 503, body: { error: 'federation disabled', code: 'FEDERATION_DISABLED' } };
  return null;
}

/**
 * Queue a Host-originated envelope without pretending that the Host is one of
 * its own Site peers. The target Site's provisioned secret signs the envelope,
 * matching the credential that Site already uses to authenticate to this Host.
 */
export function enqueueHostFederationMessage(config, input) {
  const roleError = assertHost(config);
  if (roleError) {
    const error = new Error(roleError.body.error);
    error.code = roleError.body.code || 'NOT_HOST';
    throw error;
  }
  const unsigned = createFederationEnvelope({ originSite: siteIdFor(config), ...input });
  const targetPeer = provisionedHostPeer(config, unsigned.targetSite);
  if (!targetPeer) {
    const error = new Error('target Site is not provisioned on Connecter Host');
    error.code = 'FEDERATION_TARGET_NOT_PROVISIONED';
    throw error;
  }
  const policy = authorizeFederation(config, {
    originSite: unsigned.originSite,
    targetSite: unsigned.targetSite,
    groupRef: unsigned.groupRef,
    subjectId: unsigned.toSubject,
    operation: unsigned.kind,
    direction: 'outbound',
    capabilities: unsigned.payload?.requiredCapabilities || unsigned.payload?.capability,
    dataClassification: unsigned.payload?.dataClassification || 'internal',
  });
  if (!policy.allowed) {
    const error = new Error('federation policy denied');
    error.code = 'FEDERATION_DENIED';
    throw error;
  }
  let envelope = unsigned;
  if (config?.federation?.requireSignatures !== false) {
    if (config?.federation?.requireSeparateSigningKey && !targetPeer.keys?.length) {
      throw new Error('separate federation signing key required');
    }
    if (config?.federation?.requireExternalSigningKey && !hasOnlyExternalSigningKeys(targetPeer)) {
      throw new Error('external federation signing key required');
    }
    const keys = peerVerificationKeys(targetPeer);
    const signingKey = keys.find((item) => item.status === 'active') || keys.find((item) => item.status !== 'revoked');
    envelope = signFederationEnvelope(unsigned, signingKey || {});
  }
  const quota = checkFederationQuota(config, envelope.targetSite, Buffer.byteLength(JSON.stringify(envelope)), {
    requestSiteId: envelope.originSite,
  });
  if (!quota.allowed) {
    const error = new Error('federation backpressure');
    error.code = quota.reason;
    throw error;
  }
  return writeTx((database) => {
    const existing = database
      .prepare(`SELECT envelope_json FROM federation_messages WHERE origin_site=? AND message_id=?`)
      .get(envelope.originSite, envelope.messageId);
    if (existing) {
      if (existing.envelope_json !== JSON.stringify(envelope)) {
        const error = new Error('messageId envelope conflict');
        error.code = 'FEDERATION_ID_CONFLICT';
        throw error;
      }
      return envelope;
    }
    const id = `fed_${envelope.originSite}_${envelope.messageId}`;
    database
      .prepare(
        `INSERT INTO federation_messages
         (id, origin_site, message_id, target_site, group_ref, kind, envelope_json, state, expires_at, policy_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`
      )
      .run(id, envelope.originSite, envelope.messageId, envelope.targetSite, envelope.groupRef, envelope.kind,
        JSON.stringify(envelope), envelope.expiresAt, policy.policyVersion);
    database
      .prepare(
        `INSERT INTO federation_deliveries
         (id, federation_id, target_site, status, max_attempts, policy_version)
         VALUES (?, ?, ?, 'queued', ?, ?)`
      )
      .run(`fdel_${randomUUID()}`, id, envelope.targetSite, maxAttempts(config), policy.policyVersion);
    appendAudit({ eventType: 'federation.host_enqueue', outcome: 'allow', actor: envelope.fromSubject,
      siteId: envelope.originSite, subjectId: envelope.toSubject, traceId: envelope.traceId,
      correlationId: envelope.correlationId, messageId: envelope.messageId, policyVersion: policy.policyVersion,
      detail: { targetSite: envelope.targetSite, kind: envelope.kind } });
    recordTelemetry({ eventName: 'federation.host.enqueue', siteId: envelope.originSite, traceId: envelope.traceId,
      correlationId: envelope.correlationId, messageId: envelope.messageId, subjectId: envelope.toSubject,
      detail: { targetSite: envelope.targetSite, kind: envelope.kind } });
    return envelope;
  });
}

function acceptHostTargetMessage(config, peer, envelope) {
  if (envelope.kind !== 'run.event') {
    return Promise.resolve({ status: 403, body: { error: 'Host target only accepts provider run events', code: 'FEDERATION_DENIED' } });
  }
  return writeTx((database) => {
    const dispatch = database.prepare(`SELECT * FROM workpanel_dispatches WHERE id=?`).get(envelope.correlationId);
    const expectedSubject = dispatch ? stableSubjectId({
      siteId: siteIdFor(config), kind: 'service', localId: dispatch.service_id,
    }) : null;
    if (!dispatch || dispatch.target_site !== peer.site_id || dispatch.group_ref !== envelope.groupRef ||
        dispatch.federation_message_id !== envelope.causationId || expectedSubject !== envelope.toSubject) {
      appendAudit({ eventType: 'federation.host_consume', outcome: 'deny', actor: peer.site_id,
        siteId: envelope.originSite, subjectId: envelope.toSubject, traceId: envelope.traceId,
        correlationId: envelope.correlationId, messageId: envelope.messageId,
        detail: { reason: 'PROVIDER_DISPATCH_MISMATCH' } });
      return { status: 403, body: { error: 'provider dispatch return mismatch', code: 'FEDERATION_DENIED' } };
    }
    const serialized = JSON.stringify(envelope);
    const existing = database.prepare(
      `SELECT envelope_json FROM federation_messages WHERE origin_site=? AND message_id=?`
    ).get(envelope.originSite, envelope.messageId);
    if (existing && existing.envelope_json !== serialized) {
      return { status: 409, body: { error: 'messageId envelope conflict', code: 'FEDERATION_ID_CONFLICT' } };
    }
    const projection = completeWorkpanelDispatchFromFederation(database, envelope);
    if (!existing) {
      const id = `fed_${envelope.originSite}_${envelope.messageId}`;
      database.prepare(
        `INSERT INTO federation_messages
         (id,origin_site,message_id,target_site,group_ref,kind,envelope_json,state,expires_at,policy_version)
         VALUES (?,?,?,?,?,?,?,'delivered',?,'workpanel-provider-return/v1')`
      ).run(id, envelope.originSite, envelope.messageId, envelope.targetSite, envelope.groupRef,
        envelope.kind, serialized, envelope.expiresAt);
      database.prepare(
        `INSERT INTO federation_receipts (federation_id,site_id,status,detail_json)
         VALUES (?,?,'delivered',?)`
      ).run(id, envelope.targetSite, JSON.stringify({ providerDispatchId: dispatch.id }));
    }
    appendAudit({ eventType: 'federation.host_consume', outcome: 'allow', actor: peer.site_id,
      siteId: envelope.originSite, subjectId: envelope.toSubject, traceId: envelope.traceId,
      correlationId: envelope.correlationId, messageId: envelope.messageId,
      policyVersion: 'workpanel-provider-return/v1', detail: { dispatchId: dispatch.id, status: projection.status } });
    recordTelemetry({ eventName: 'federation.host.consume', siteId: envelope.originSite,
      traceId: envelope.traceId, correlationId: envelope.correlationId, messageId: envelope.messageId,
      subjectId: envelope.toSubject, detail: { dispatchId: dispatch.id, status: projection.status } });
    return { status: 202, body: { accepted: true, duplicate: Boolean(existing), messageId: envelope.messageId, status: 'delivered' } };
  });
}

export function acceptFederationMessage(config, peer, input) {
  const roleError = assertHost(config);
  if (roleError) return Promise.resolve(roleError);
  let envelope;
  try {
    envelope = validateFederationEnvelope(input, {
      maxPayloadBytes: Number(config?.federation?.maxPayloadBytes) || 131072,
    });
  } catch (error) {
    return Promise.resolve({ status: 400, body: { error: error.message, code: 'INVALID_FEDERATION_ENVELOPE' } });
  }
  if (!peer || envelope.originSite !== peer.site_id) {
    return Promise.resolve({ status: 403, body: { error: 'originSite does not match peer identity', code: 'ORIGIN_SITE_MISMATCH' } });
  }
  const ttlMs = Date.parse(envelope.expiresAt) - Date.parse(envelope.createdAt);
  const maxTtlMs = Math.min(Math.max(Number(config?.federation?.maxTtlSec) || 86400, 1), 86400) * 1000;
  if (ttlMs > maxTtlMs) return Promise.resolve({ status: 400, body: { error: 'federation TTL exceeds configured maximum', code: 'TTL_LIMIT' } });
  const originConfig = config?.host?.peers?.find((item) => item.siteId === envelope.originSite);
  if (config?.federation?.requireSignatures !== false &&
      ((config?.federation?.requireSeparateSigningKey && !originConfig?.keys?.length) ||
       (config?.federation?.requireExternalSigningKey && !hasOnlyExternalSigningKeys(originConfig)) ||
       !verifyFederationEnvelopeSignature(envelope, peerVerificationKeys(originConfig)))) {
    appendAudit({ eventType: 'federation.signature', outcome: 'deny', actor: peer.site_id, siteId: envelope.originSite,
      traceId: envelope.traceId, correlationId: envelope.correlationId, messageId: envelope.messageId });
    return Promise.resolve({ status: 401, body: { error: 'invalid federation signature', code: 'INVALID_SIGNATURE' } });
  }
  if (envelope.targetSite === siteIdFor(config)) return acceptHostTargetMessage(config, peer, envelope);
  if (!config?.host?.peers?.some((item) => item.siteId === envelope.targetSite)) {
    return Promise.resolve({ status: 403, body: { error: 'federation policy denied', code: 'FEDERATION_DENIED' } });
  }
  const policy = authorizeFederation(config, { originSite: envelope.originSite, targetSite: envelope.targetSite,
    groupRef: envelope.groupRef, subjectId: envelope.toSubject, operation: envelope.kind, direction: 'outbound',
    capabilities: envelope.payload?.requiredCapabilities || envelope.payload?.capability,
    dataClassification: envelope.payload?.dataClassification || 'internal' });
  if (!policy.allowed) {
    appendAudit({ eventType: 'federation.policy', outcome: 'deny', actor: peer.site_id, siteId: envelope.originSite,
      subjectId: envelope.toSubject, traceId: envelope.traceId, correlationId: envelope.correlationId,
      messageId: envelope.messageId, policyVersion: policy.policyVersion, detail: { reason: policy.reason } });
    return Promise.resolve({ status: 403, body: { error: 'federation policy denied', code: 'FEDERATION_DENIED' } });
  }
  const quota = checkFederationQuota(config, envelope.targetSite, Buffer.byteLength(JSON.stringify(envelope)), {
    requestSiteId: envelope.originSite,
  });
  if (!quota.allowed) return Promise.resolve({ status: quota.status, body: { error: 'federation backpressure', code: quota.reason } });
  return writeTx((database) => {
    const existing = database
      .prepare(`SELECT * FROM federation_messages WHERE origin_site=? AND message_id=?`)
      .get(envelope.originSite, envelope.messageId);
    if (existing) {
      if (existing.envelope_json !== JSON.stringify(envelope)) {
        return { status: 409, body: { error: 'messageId envelope conflict', code: 'FEDERATION_ID_CONFLICT' } };
      }
      const delivery = database.prepare(`SELECT * FROM federation_deliveries WHERE federation_id=?`).get(existing.id);
      return { status: 202, body: { accepted: true, duplicate: true, messageId: envelope.messageId, status: delivery?.status } };
    }
    const id = `fed_${envelope.originSite}_${envelope.messageId}`;
    database
      .prepare(
        `INSERT INTO federation_messages
         (id, origin_site, message_id, target_site, group_ref, kind, envelope_json, state, expires_at, policy_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`
      )
      .run(id, envelope.originSite, envelope.messageId, envelope.targetSite, envelope.groupRef, envelope.kind, JSON.stringify(envelope), envelope.expiresAt, policy.policyVersion);
    database
      .prepare(
        `INSERT INTO federation_deliveries
         (id, federation_id, target_site, status, max_attempts, policy_version)
         VALUES (?, ?, ?, 'queued', ?, ?)`
      )
      .run(`fdel_${randomUUID()}`, id, envelope.targetSite, maxAttempts(config), policy.policyVersion);
    appendAudit({ eventType: 'federation.accept', outcome: 'allow', actor: peer.site_id, siteId: envelope.originSite,
      subjectId: envelope.toSubject, traceId: envelope.traceId, correlationId: envelope.correlationId,
      messageId: envelope.messageId, policyVersion: policy.policyVersion });
    recordTelemetry({ eventName: 'federation.host.accept', siteId: envelope.originSite, traceId: envelope.traceId,
      correlationId: envelope.correlationId, messageId: envelope.messageId, subjectId: envelope.toSubject,
      detail: { targetSite: envelope.targetSite, kind: envelope.kind } });
    return { status: 202, body: { accepted: true, messageId: envelope.messageId, status: 'queued' } };
  });
}

function reclaimExpiredDeliveriesTx(database, siteId) {
  const expired = database
    .prepare(
      `SELECT * FROM federation_deliveries
       WHERE target_site=? AND status IN ('leased','acknowledged') AND lease_until<=datetime('now')`
    )
    .all(siteId);
  for (const row of expired) {
    const dead = row.attempt >= row.max_attempts;
    database
      .prepare(
        `UPDATE federation_deliveries SET status=?, lease_token_hash=NULL, lease_until=NULL,
         last_error=?, updated_at=datetime('now'), completed_at=CASE WHEN ? THEN datetime('now') ELSE completed_at END
         WHERE id=?`
      )
      .run(dead ? 'dead' : 'queued', dead ? 'lease_expired_max_attempts' : 'lease_expired', dead ? 1 : 0, row.id);
  }
}

function pullOnce(config, peer, limit) {
  return writeTx((database) => {
    reclaimExpiredDeliveriesTx(database, peer.site_id);
    database
      .prepare(
        `UPDATE federation_deliveries SET status='expired', completed_at=datetime('now'), updated_at=datetime('now')
         WHERE target_site=? AND status IN ('queued','leased')
           AND federation_id IN (SELECT id FROM federation_messages WHERE expires_at<=datetime('now'))`
      )
      .run(peer.site_id);
    const rows = database
      .prepare(
        `SELECT d.*, m.envelope_json, m.origin_site, m.message_id
         FROM federation_deliveries d JOIN federation_messages m ON m.id=d.federation_id
         WHERE d.target_site=? AND d.status='queued' AND m.expires_at>datetime('now')
         ORDER BY d.created_at LIMIT ?`
      )
      .all(peer.site_id, Math.min(Math.max(Number(limit) || 10, 1), 100));
    const messages = [];
    for (const row of rows) {
      const token = `fedlease_${randomUUID()}_${randomUUID()}`;
      database
        .prepare(
          `UPDATE federation_deliveries SET status='leased', lease_token_hash=?,
           lease_until=datetime('now', ?), attempt=attempt+1, updated_at=datetime('now') WHERE id=? AND status='queued'`
        )
        .run(hashToken(token), `+${leaseSec(config)} seconds`, row.id);
      messages.push({ envelope: JSON.parse(row.envelope_json), leaseToken: token, leaseSec: leaseSec(config), attempt: row.attempt + 1 });
    }
    return messages;
  });
}

export async function pullFederationMessages(config, peer, { limit = 10, waitMs = 0 } = {}) {
  const roleError = assertHost(config);
  if (roleError) return roleError;
  if (!peer?.site_id) return { status: 403, body: { error: 'peer token required' } };
  const current = activePulls.get(peer.site_id) || 0;
  const maxConcurrent = Math.min(Math.max(Number(config?.federation?.quotas?.maxConcurrentPulls) || 2, 1), 20);
  if (current >= maxConcurrent) return { status: 429, body: { error: 'too many concurrent pulls', code: 'SITE_PULL_LIMIT' } };
  activePulls.set(peer.site_id, current + 1);
  try {
    const deadline = Date.now() + Math.min(Math.max(Number(waitMs) || 0, 0), 25000);
    do {
      const messages = await pullOnce(config, peer, limit);
      if (messages.length || Date.now() >= deadline) return { status: 200, body: { messages } };
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    return { status: 200, body: { messages: [] } };
  } finally {
    const next = (activePulls.get(peer.site_id) || 1) - 1;
    if (next > 0) activePulls.set(peer.site_id, next); else activePulls.delete(peer.site_id);
  }
}

function findDeliveryForLease(database, peer, body) {
  const row = database
    .prepare(
      `SELECT d.*, m.origin_site, m.message_id FROM federation_deliveries d
       JOIN federation_messages m ON m.id=d.federation_id
       WHERE d.target_site=? AND m.origin_site=? AND m.message_id=?`
    )
    .get(peer.site_id, body.originSite, body.messageId);
  if (!row) return { error: { status: 404, body: { error: 'federation delivery not found' } } };
  if (['delivered', 'failed'].includes(row.status)) return { row };
  if (!body.leaseToken || hashToken(body.leaseToken) !== row.lease_token_hash) {
    return { error: { status: 409, body: { error: 'stale federation lease', code: 'STALE_FEDERATION_LEASE' } } };
  }
  return { row };
}

export function ackFederationMessage(config, peer, body = {}) {
  const roleError = assertHost(config);
  if (roleError) return Promise.resolve(roleError);
  return writeTx((database) => {
    const found = findDeliveryForLease(database, peer, body);
    if (found.error) return found.error;
    const row = found.row;
    if (['acknowledged', 'delivered', 'failed'].includes(row.status)) {
      return { status: 200, body: { ok: true, duplicate: true, status: row.status } };
    }
    database
      .prepare(
        `UPDATE federation_deliveries SET status='acknowledged', acknowledged_at=datetime('now'),
         lease_until=datetime('now','+1 hour'), updated_at=datetime('now') WHERE id=?`
      )
      .run(row.id);
    return { status: 200, body: { ok: true, messageId: row.message_id, status: 'acknowledged' } };
  });
}

export function completeFederationMessage(config, peer, body = {}) {
  const roleError = assertHost(config);
  if (roleError) return Promise.resolve(roleError);
  return writeTx((database) => {
    const found = findDeliveryForLease(database, peer, body);
    if (found.error) return found.error;
    const row = found.row;
    const status = body.status === 'delivered' ? 'delivered' : 'failed';
    if (['delivered', 'failed'].includes(row.status)) {
      return { status: 200, body: { ok: true, duplicate: true, status: row.status } };
    }
    database
      .prepare(
        `UPDATE federation_deliveries SET status=?, completed_at=datetime('now'), last_error=?,
         lease_token_hash=NULL, lease_until=NULL, updated_at=datetime('now') WHERE id=?`
      )
      .run(status, status === 'failed' ? String(body.error || 'target failed') : null, row.id);
    database.prepare(`UPDATE federation_messages SET state=?, updated_at=datetime('now') WHERE id=?`).run(status, row.federation_id);
    database
      .prepare(`INSERT INTO federation_receipts (federation_id, site_id, status, detail_json) VALUES (?, ?, ?, ?)`)
      .run(row.federation_id, peer.site_id, status, JSON.stringify(body.detail || {}));
    appendAudit({ eventType: 'federation.complete', outcome: status, actor: peer.site_id, siteId: peer.site_id,
      messageId: row.message_id, policyVersion: row.policy_version, detail: { error: body.error } });
    const message = database.prepare(`SELECT envelope_json FROM federation_messages WHERE id=?`).get(row.federation_id);
    const envelope = message ? JSON.parse(message.envelope_json) : {};
    recordTelemetry({ eventName: 'federation.host.complete', siteId: peer.site_id, traceId: envelope.traceId,
      correlationId: envelope.correlationId, messageId: row.message_id, detail: { status } });
    return { status: 200, body: { ok: true, messageId: row.message_id, status } };
  });
}

export function advertiseFederationRoutes(config, peer, body = {}) {
  const roleError = assertHost(config);
  if (roleError) return Promise.resolve(roleError);
  const routes = Array.isArray(body.routes) ? body.routes.slice(0, 1000) : [];
  const ttl = Math.min(Math.max(Number(body.ttlSec) || 90, 10), 600);
  return writeTx((database) => {
    database.prepare(`UPDATE federation_routes SET status='withdrawn' WHERE site_id=?`).run(peer.site_id);
    for (const route of routes) {
      if (!route?.groupRef || !route?.subjectId) continue;
      try { parseGroupRef(route.groupRef); } catch { continue; }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.subjectId)) continue;
      const owner = database.prepare(`SELECT site_id FROM federation_routes WHERE subject_id=? AND site_id!=? LIMIT 1`).get(route.subjectId, peer.site_id);
      if (owner) {
        appendAudit({ eventType: 'directory.subject_collision', outcome: 'deny', actor: peer.site_id, siteId: peer.site_id,
          subjectId: route.subjectId, detail: { existingSite: owner.site_id } });
        continue;
      }
      database
        .prepare(
          `INSERT INTO federation_routes
           (id, group_ref, subject_id, display_name, site_id, capabilities_json, version, status, last_seen_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now', ?))
           ON CONFLICT(group_ref, subject_id, site_id) DO UPDATE SET display_name=excluded.display_name,
             capabilities_json=excluded.capabilities_json, version=excluded.version, status='active',
             last_seen_at=datetime('now'), expires_at=excluded.expires_at`
        )
        .run(
          `froute_${peer.site_id}_${route.subjectId}_${hashToken(route.groupRef).slice(0, 12)}`,
          route.groupRef,
          route.subjectId,
          route.displayName || null,
          peer.site_id,
          JSON.stringify(route.capabilities || []),
          Number(route.version) || 1,
          `+${ttl} seconds`
        );
    }
    return { status: 200, body: { ok: true, siteId: peer.site_id, routes: routes.length, ttlSec: ttl } };
  });
}

export function listFederationRoutes(config, peer, { groupRef } = {}) {
  const roleError = assertHost(config);
  if (roleError) return roleError;
  let sql = `SELECT * FROM federation_routes WHERE status='active' AND expires_at>datetime('now')`;
  const params = [];
  if (groupRef) { sql += ' AND group_ref=?'; params.push(groupRef); }
  sql += ' ORDER BY group_ref, site_id, display_name';
  const routes = db().prepare(sql).all(...params).filter((row) => {
    if (!peer?.site_id || row.site_id === peer.site_id) return false;
    return authorizeFederation(config, { originSite: peer.site_id, targetSite: row.site_id, groupRef: row.group_ref,
      subjectId: row.subject_id, operation: 'chat.command', direction: 'outbound',
      capabilities: JSON.parse(row.capabilities_json || '[]') }).allowed;
  }).map((row) => ({
    groupRef: row.group_ref, subjectId: row.subject_id, displayName: row.display_name,
    siteId: row.site_id, capabilities: JSON.parse(row.capabilities_json || '[]'), version: row.version,
  }));
  return { status: 200, body: { routes } };
}
