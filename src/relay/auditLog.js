import { db } from './db.js';
import { redactAuditDetails } from './services/auditService.js';

export function appendAudit(event) {
  db().prepare(
    `INSERT INTO audit_events (event_type,outcome,actor,site_id,subject_id,trace_id,correlation_id,message_id,task_id,policy_version,detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(event.eventType, event.outcome, event.actor || null, event.siteId || null, event.subjectId || null,
    event.traceId || null, event.correlationId || null, event.messageId || null, event.taskId || null,
    event.policyVersion || null, JSON.stringify(redactAuditDetails(event.detail || {})));
}
