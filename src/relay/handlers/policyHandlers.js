import { randomUUID } from 'node:crypto';
import { appendAudit } from '../auditLog.js';
import { db, writeTx } from '../db.js';

function text(value, field, { optional = false, fallback } = {}) {
  const result = value == null ? fallback : String(value).trim();
  if (!result && !optional) throw new Error(`${field} required`);
  if (result && result.length > 512) throw new Error(`${field} too long`);
  return result || null;
}

export function listFederationPolicies({ status, limit = 200 } = {}) {
  let sql = `SELECT id,origin_site,target_site,group_ref,subject_id,operation,direction,capability,
                    data_classification,effect,version,status,created_at
             FROM federation_policies`;
  const params = [];
  if (status) { sql += ` WHERE status=?`; params.push(status); }
  sql += ` ORDER BY created_at DESC,id LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  return db().prepare(sql).all(...params);
}

export async function createFederationPolicy(input, { actor = 'ops' } = {}) {
  let policy;
  try {
    policy = {
      id: text(input?.id, 'id', { optional: true }) || `policy_${randomUUID()}`,
      originSite: text(input?.originSite, 'originSite'), targetSite: text(input?.targetSite, 'targetSite'),
      groupRef: text(input?.groupRef, 'groupRef'), subjectId: text(input?.subjectId, 'subjectId', { optional: true }),
      operation: text(input?.operation, 'operation'), direction: text(input?.direction, 'direction'),
      capability: text(input?.capability, 'capability', { fallback: '*' }),
      dataClassification: text(input?.dataClassification, 'dataClassification', { fallback: 'internal' }),
      effect: text(input?.effect, 'effect'), version: text(input?.version, 'version'),
    };
  } catch (error) {
    return { status: 400, body: { error: String(error.message || error), code: 'INVALID_POLICY' } };
  }
  if (!['allow', 'deny'].includes(policy.effect)) return { status: 400, body: { error: 'effect must be allow or deny', code: 'INVALID_POLICY' } };
  if (!['inbound', 'outbound', '*'].includes(policy.direction)) return { status: 400, body: { error: 'direction must be inbound, outbound or *', code: 'INVALID_POLICY' } };
  try {
    await writeTx((database) => database.prepare(
      `INSERT INTO federation_policies
       (id,origin_site,target_site,group_ref,subject_id,operation,direction,capability,data_classification,effect,version,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'active')`
    ).run(policy.id, policy.originSite, policy.targetSite, policy.groupRef, policy.subjectId, policy.operation,
      policy.direction, policy.capability, policy.dataClassification, policy.effect, policy.version));
  } catch (error) {
    if (String(error.message || error).includes('UNIQUE')) return { status: 409, body: { error: 'policy already exists', code: 'POLICY_CONFLICT' } };
    throw error;
  }
  appendAudit({ eventType: 'policy.create', outcome: 'allow', actor, policyVersion: policy.version,
    detail: { policyId: policy.id, effect: policy.effect } });
  return { status: 201, body: { policy } };
}

export async function disableFederationPolicy(id, { actor = 'ops' } = {}) {
  const policy = db().prepare(`SELECT id,version,status FROM federation_policies WHERE id=?`).get(id);
  if (!policy) return { status: 404, body: { error: 'policy not found', code: 'POLICY_NOT_FOUND' } };
  if (policy.status !== 'disabled') {
    await writeTx((database) => database.prepare(`UPDATE federation_policies SET status='disabled' WHERE id=?`).run(id));
    appendAudit({ eventType: 'policy.disable', outcome: 'allow', actor, policyVersion: policy.version,
      detail: { policyId: id } });
  }
  return { status: 200, body: { id, status: 'disabled', duplicate: policy.status === 'disabled' } };
}
