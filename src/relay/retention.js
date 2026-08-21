import { writeTx } from './db.js';

function boundedDays(value, fallback, max = 3650) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
}

export function enforceRetention(config) {
  const terminalDays = boundedDays(config?.retention?.terminalDays, 30);
  const telemetryDays = boundedDays(config?.retention?.telemetryDays, 14);
  const auditDays = boundedDays(config?.retention?.auditDays, 90);
  return writeTx((database) => {
    const oldIds = database.prepare(
      `SELECT federation_id FROM federation_deliveries WHERE status IN ('delivered','failed','expired','dead') AND completed_at<datetime('now', ?)`
    ).all(`-${terminalDays} days`).map((row) => row.federation_id);
    for (const id of oldIds) {
      database.prepare(`DELETE FROM federation_receipts WHERE federation_id=?`).run(id);
      database.prepare(`DELETE FROM federation_deliveries WHERE federation_id=?`).run(id);
      database.prepare(`DELETE FROM federation_messages WHERE id=?`).run(id);
    }
    const telemetry = database.prepare(`DELETE FROM telemetry_events WHERE created_at<datetime('now', ?)`).run(`-${telemetryDays} days`).changes;
    database.prepare(`UPDATE audit_retention_context SET enabled=1 WHERE id=1`).run();
    let auditArchived = 0;
    try {
      auditArchived = database.prepare(
        `INSERT OR IGNORE INTO audit_events_archive
         (id,event_type,outcome,actor,site_id,subject_id,trace_id,correlation_id,message_id,task_id,policy_version,detail_json,created_at)
         SELECT id,event_type,outcome,actor,site_id,subject_id,trace_id,correlation_id,message_id,task_id,policy_version,detail_json,created_at
         FROM audit_events WHERE created_at<datetime('now', ?)`
      ).run(`-${auditDays} days`).changes;
      database.prepare(`DELETE FROM audit_events WHERE created_at<datetime('now', ?)`).run(`-${auditDays} days`);
    } finally {
      database.prepare(`UPDATE audit_retention_context SET enabled=0 WHERE id=1`).run();
    }
    return { federationMessages: oldIds.length, telemetry, auditArchived };
  });
}
