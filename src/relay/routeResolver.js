import { db } from './db.js';
import { ROUTE_POLICY_VERSION, evaluateRouteCandidate } from './policy.js';
import { newTraceContext, normalizeSiteId } from './services/identityService.js';

function capabilitiesFor(database, endpointId) {
  return database
    .prepare(`SELECT name, version FROM capabilities WHERE endpoint_id=?`)
    .all(endpointId);
}

function recordDecision(database, decision) {
  database
    .prepare(
      `INSERT INTO route_decisions
       (trace_id, group_ref, target_subject_id, selected_endpoint_id, policy_version, reason, considered_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      decision.traceId,
      decision.groupRef,
      decision.targetSubjectId || null,
      decision.target?.endpointId || null,
      decision.policyVersion,
      decision.reason,
      JSON.stringify(decision.considered)
    );
}

export function resolveRoute({
  groupRef,
  targetSubjectId,
  agentName,
  requiredCapabilities = [],
  sourceSiteId = 'local',
  traceId,
} = {}) {
  const database = db();
  const sourceSite = normalizeSiteId(sourceSiteId);
  const trace = traceId ? { traceId } : newTraceContext();
  let sql =
    `SELECT s.subject_id, s.site_id, s.local_id, s.display_name,
            m.status AS membership_status, m.role AS membership_role,
            e.endpoint_id, e.status AS endpoint_status, e.runtime, e.max_concurrency,
            e.load, e.labels_json, e.expires_at, datetime('now') AS now
     FROM subjects s
     JOIN memberships m ON m.subject_id=s.subject_id AND m.group_ref=?
     JOIN endpoints e ON e.subject_id=s.subject_id
     WHERE s.kind='agent' AND s.status='active'`;
  const params = [groupRef];
  if (targetSubjectId) {
    sql += ' AND s.subject_id=?';
    params.push(targetSubjectId);
  } else if (agentName) {
    sql += ' AND s.display_name=?';
    params.push(agentName);
  }
  const rows = database.prepare(sql).all(...params);
  const considered = rows.map((row) => {
    const capabilities = capabilitiesFor(database, row.endpoint_id);
    const verdict = evaluateRouteCandidate({
      membership: { status: row.membership_status, role: row.membership_role },
      endpoint: { status: row.endpoint_status, expires_at: row.expires_at, now: row.now },
      capabilities,
      requiredCapabilities: requiredCapabilities.map((name) => String(name).toLowerCase()),
    });
    let labels = {};
    try { labels = JSON.parse(row.labels_json || '{}'); } catch {}
    return {
      subjectId: row.subject_id,
      endpointId: row.endpoint_id,
      siteId: row.site_id,
      localId: row.local_id,
      displayName: row.display_name,
      runtime: row.runtime,
      maxConcurrency: row.max_concurrency,
      load: Number(row.load || 0),
      labels,
      capabilities,
      allowed: verdict.allowed,
      reason: verdict.reason,
      missing: verdict.missing || [],
    };
  });
  const ambiguousSubject = !targetSubjectId && Boolean(agentName) && new Set(rows.map((row) => row.subject_id)).size > 1;
  const eligible = considered
    .filter((item) => item.allowed)
    .sort((a, b) => {
      const localA = a.siteId === sourceSite ? 0 : 1;
      const localB = b.siteId === sourceSite ? 0 : 1;
      if (localA !== localB) return localA - localB;
      const priorityA = Number(a.labels.priority || 0);
      const priorityB = Number(b.labels.priority || 0);
      if (priorityA !== priorityB) return priorityB - priorityA;
      if (a.load !== b.load) return a.load - b.load;
      return a.endpointId.localeCompare(b.endpointId);
    });
  const selected = ambiguousSubject ? null : eligible[0] || null;
  const offlineOnly = rows.length > 0 && considered.every((item) => ['ENDPOINT_EXPIRED', 'ENDPOINT_OFFLINE'].includes(item.reason));
  const decision = {
    traceId: trace.traceId,
    groupRef,
    targetSubjectId: targetSubjectId || selected?.subjectId || null,
    target: selected,
    considered,
    policyVersion: ROUTE_POLICY_VERSION,
    reason: ambiguousSubject
      ? 'AMBIGUOUS_SUBJECT'
      : selected
      ? selected.siteId === sourceSite ? 'LOCAL_ELIGIBLE_ENDPOINT' : 'REMOTE_ELIGIBLE_ENDPOINT'
      : rows.length ? offlineOnly ? 'NO_ONLINE_ENDPOINT' : 'NO_ELIGIBLE_ENDPOINT' : 'NO_MATCHING_SUBJECT',
  };
  recordDecision(database, decision);
  return decision;
}

export function getRouteDecision(traceId) {
  const row = db().prepare(`SELECT * FROM route_decisions WHERE trace_id=? ORDER BY id DESC LIMIT 1`).get(traceId);
  return row ? { ...row, considered: JSON.parse(row.considered_json || '[]') } : null;
}
