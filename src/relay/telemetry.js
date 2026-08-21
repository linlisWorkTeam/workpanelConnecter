import { db } from './db.js';
import { redactAuditDetails } from './services/auditService.js';

export function recordTelemetry(event) {
  db().prepare(
    `INSERT INTO telemetry_events (level,event_name,site_id,trace_id,correlation_id,message_id,subject_id,task_id,duration_ms,detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(event.level || 'info', event.eventName, event.siteId || null, event.traceId || null,
    event.correlationId || null, event.messageId || null, event.subjectId || null, event.taskId || null,
    event.durationMs == null ? null : Number(event.durationMs), JSON.stringify(redactAuditDetails(event.detail || {})));
}

export function operationalHealthDetail() {
  const database = db();
  const scalar = (sql) => Number(database.prepare(sql).get()?.n || 0);
  const latency = database.prepare(
    `SELECT COALESCE(AVG((julianday(completed_at)-julianday(created_at))*86400000),0) average_ms,
            COALESCE(MAX((julianday(completed_at)-julianday(created_at))*86400000),0) maximum_ms
     FROM federation_deliveries WHERE completed_at IS NOT NULL`
  ).get();
  return {
    sitesOnline: scalar(`SELECT COUNT(*) n FROM connecter_peers WHERE status='active' AND last_seen_at>datetime('now','-90 seconds')`),
    runnersOnline: scalar(`SELECT COUNT(*) n FROM runners WHERE status='active' AND last_seen_at>datetime('now','-60 seconds')`),
    runnerQueueDepth: scalar(`SELECT COUNT(*) n FROM runner_tasks WHERE status='queued'`),
    federationQueueDepth: scalar(`SELECT COUNT(*) n FROM federation_deliveries WHERE status IN ('queued','leased','acknowledged')`),
    federationOutboxDepth: scalar(`SELECT COUNT(*) n FROM federation_outbox WHERE status IN ('queued','retry','accepted')`),
    federationInboxDepth: scalar(`SELECT COUNT(*) n FROM federation_inbox WHERE status IN ('received','retry','processing','awaiting_ack','processed')`),
    federationOutboxBytes: scalar(`SELECT COALESCE(SUM(length(envelope_json)),0) n FROM federation_outbox WHERE status IN ('queued','retry','accepted')`),
    federationDeliveryLatencyMs: { average: Number(latency.average_ms || 0), maximum: Number(latency.maximum_ms || 0) },
    leaseExpiries: scalar(`SELECT COUNT(*) n FROM runner_task_audit WHERE action='lease_expired'`) + scalar(`SELECT COUNT(*) n FROM federation_deliveries WHERE last_error LIKE 'lease_expired%'`),
    retries: scalar(`SELECT COALESCE(SUM(attempt-1),0) n FROM runner_tasks WHERE attempt>1`) +
      scalar(`SELECT COALESCE(SUM(attempt-1),0) n FROM federation_deliveries WHERE attempt>1`) +
      scalar(`SELECT COALESCE(SUM(attempt-1),0) n FROM federation_outbox WHERE attempt>1`) +
      scalar(`SELECT COALESCE(SUM(attempt-1),0) n FROM federation_inbox WHERE attempt>1`),
    deadLetters: scalar(`SELECT COUNT(*) n FROM runner_tasks WHERE status='dead'`) +
      scalar(`SELECT COUNT(*) n FROM federation_deliveries WHERE status='dead'`) +
      scalar(`SELECT COUNT(*) n FROM federation_outbox WHERE status='dead'`) +
      scalar(`SELECT COUNT(*) n FROM federation_inbox WHERE status='dead'`),
    aclDenies: scalar(`SELECT COUNT(*) n FROM audit_events WHERE event_type='federation.policy' AND outcome='deny'`),
    wpWriteBackFailures: scalar(`SELECT COUNT(*) n FROM delivery_log WHERE target LIKE 'workpanel:%' AND result LIKE 'dead:%'`),
  };
}

export function traceTimeline(traceId) {
  const database = db();
  return {
    traceId,
    routes: database.prepare(`SELECT * FROM route_decisions WHERE trace_id=? ORDER BY created_at,id`).all(traceId),
    audit: database.prepare(
      `SELECT id,event_type,outcome,actor,site_id,subject_id,trace_id,correlation_id,message_id,task_id,policy_version,detail_json,created_at,'live' source
       FROM audit_events WHERE trace_id=?
       UNION ALL
       SELECT id,event_type,outcome,actor,site_id,subject_id,trace_id,correlation_id,message_id,task_id,policy_version,detail_json,created_at,'archive' source
       FROM audit_events_archive WHERE trace_id=? ORDER BY created_at,id`
    ).all(traceId, traceId).map((row) => ({ ...row, detail: JSON.parse(row.detail_json || '{}') })),
    telemetry: database.prepare(`SELECT * FROM telemetry_events WHERE trace_id=? ORDER BY created_at,id`).all(traceId).map((row) => ({ ...row, detail: JSON.parse(row.detail_json || '{}') })),
  };
}

export function listSecurityDeliveries({ siteId, keyId, status, since, until, limit = 200 } = {}) {
  let sql =
    `SELECT m.origin_site,m.message_id,m.target_site,m.group_ref,m.kind,m.envelope_json,m.created_at,
            d.status,d.attempt,d.last_error,d.completed_at,d.policy_version
     FROM federation_messages m JOIN federation_deliveries d ON d.federation_id=m.id WHERE 1=1`;
  const params = [];
  if (siteId) { sql += ` AND (m.origin_site=? OR m.target_site=?)`; params.push(siteId, siteId); }
  if (keyId) { sql += ` AND json_extract(m.envelope_json,'$.keyId')=?`; params.push(keyId); }
  if (status) { sql += ` AND d.status=?`; params.push(status); }
  if (since) { sql += ` AND m.created_at>=?`; params.push(since); }
  if (until) { sql += ` AND m.created_at<=?`; params.push(until); }
  sql += ` ORDER BY m.created_at DESC LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  return db().prepare(sql).all(...params).map((row) => {
    const envelope = JSON.parse(row.envelope_json);
    return { originSite: row.origin_site, messageId: row.message_id, targetSite: row.target_site,
      groupRef: row.group_ref, kind: row.kind, status: row.status, attempt: row.attempt,
      lastError: row.last_error, createdAt: row.created_at, completedAt: row.completed_at,
      policyVersion: row.policy_version, keyId: envelope.keyId || null, traceId: envelope.traceId || null,
      correlationId: envelope.correlationId || null };
  });
}
