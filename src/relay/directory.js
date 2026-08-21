import { randomUUID } from 'node:crypto';
import { db, writeTx } from './db.js';
import { groupRef, normalizeSiteId, stableSubjectId } from './services/identityService.js';

export function siteIdFor(config) {
  return normalizeSiteId(config?.host?.siteId || config?.siteId || 'local');
}

export function endpointIdFor(subjectId) {
  return `ep_${subjectId}`;
}

export function upsertSubjectTx(database, { siteId, kind, localId, displayName, status = 'active' }) {
  const subjectId = stableSubjectId({ siteId, kind, localId });
  database
    .prepare(
      `INSERT INTO subjects (subject_id, site_id, kind, local_id, display_name, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, kind, local_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, subjects.display_name),
         status = excluded.status, updated_at = datetime('now')`
    )
    .run(subjectId, siteId, kind, localId, displayName || localId, status);
  return subjectId;
}

export function upsertRunnerDirectoryTx(
  database,
  config,
  { runnerId, displayName, runtime, bindings = [], registration = {}, online = true }
) {
  const siteId = siteIdFor(config);
  const subjectId = upsertSubjectTx(database, {
    siteId,
    kind: 'agent',
    localId: runnerId,
    displayName: displayName || runnerId,
  });
  const endpointId = endpointIdFor(subjectId);
  const ttl = Number(config?.runnerHeartbeatTtlSec) > 0 ? Number(config.runnerHeartbeatTtlSec) : 60;
  database
    .prepare(
      `INSERT INTO endpoints
       (endpoint_id, subject_id, protocol, protocol_version, runtime, status, max_concurrency, load,
        labels_json, last_seen_at, expires_at)
       VALUES (?, ?, 'connecter.runner', ?, ?, ?, ?, ?, ?,
               CASE WHEN ? THEN datetime('now') ELSE NULL END,
               CASE WHEN ? THEN datetime('now', ?) ELSE NULL END)
       ON CONFLICT(endpoint_id) DO UPDATE SET
         protocol_version = excluded.protocol_version, runtime = excluded.runtime,
         status = excluded.status, max_concurrency = excluded.max_concurrency,
         load = excluded.load, labels_json = excluded.labels_json,
         last_seen_at = COALESCE(excluded.last_seen_at, endpoints.last_seen_at),
         expires_at = COALESCE(excluded.expires_at, endpoints.expires_at), updated_at = datetime('now')`
    )
    .run(
      endpointId,
      subjectId,
      registration.protocolVersion || 1,
      runtime || 'local',
      online ? 'active' : 'registered',
      registration.maxConcurrency || 1,
      registration.load || 0,
      JSON.stringify(registration.labels || {}),
      online ? 1 : 0,
      online ? 1 : 0,
      `+${ttl} seconds`
    );
  database.prepare(`DELETE FROM capabilities WHERE endpoint_id = ?`).run(endpointId);
  for (const capability of registration.capabilities || []) {
    database
      .prepare(
        `INSERT INTO capabilities (endpoint_id, name, version, labels_json, limits_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        endpointId,
        capability.name,
        capability.version,
        JSON.stringify(capability.labels || {}),
        JSON.stringify(capability.limits || {})
      );
  }
  for (const binding of bindings) {
    const ref = binding.groupRef || groupRef({ authority: siteId, groupId: binding.groupId || binding.group_id });
    const membershipId = stableSubjectId({
      siteId,
      kind: 'service',
      localId: `membership:${ref}:${subjectId}`,
    });
    database
      .prepare(
        `INSERT INTO memberships (id, group_ref, subject_id, role, permissions_json, status, source)
         VALUES (?, ?, ?, ?, ?, 'active', 'runner-binding')
         ON CONFLICT(group_ref, subject_id) DO UPDATE SET
           role = excluded.role, permissions_json = excluded.permissions_json,
           status = 'active', source = excluded.source, updated_at = datetime('now')`
      )
      .run(membershipId, ref, subjectId, binding.role || 'agent', JSON.stringify(['execute', 'reply']));
  }
  if (online) {
    database
      .prepare(
        `INSERT INTO presence_observations (subject_id, source, state, observed_at, expires_at, detail_json)
         VALUES (?, 'runner-heartbeat', 'online', datetime('now'), datetime('now', ?), ?)
         ON CONFLICT(subject_id, source) DO UPDATE SET state = 'online', observed_at = datetime('now'),
           expires_at = excluded.expires_at, detail_json = excluded.detail_json`
      )
      .run(subjectId, `+${ttl} seconds`, JSON.stringify({ endpointId, load: registration.load || 0 }));
  }
  return { siteId, subjectId, endpointId };
}

export function touchRunnerDirectory(config, runnerId, { load } = {}) {
  const siteId = siteIdFor(config);
  const subjectId = stableSubjectId({ siteId, kind: 'agent', localId: runnerId });
  const ttl = Number(config?.runnerHeartbeatTtlSec) > 0 ? Number(config.runnerHeartbeatTtlSec) : 60;
  const endpointId = endpointIdFor(subjectId);
  db()
    .prepare(
      `UPDATE endpoints SET status = 'active', load = COALESCE(?, load), last_seen_at = datetime('now'),
       expires_at = datetime('now', ?), updated_at = datetime('now') WHERE endpoint_id = ?`
    )
    .run(load == null ? null : Number(load), `+${ttl} seconds`, endpointId);
  db()
    .prepare(
      `INSERT INTO presence_observations (subject_id, source, state, observed_at, expires_at, detail_json)
       VALUES (?, 'runner-heartbeat', 'online', datetime('now'), datetime('now', ?), ?)
       ON CONFLICT(subject_id, source) DO UPDATE SET state='online', observed_at=datetime('now'),
         expires_at=excluded.expires_at, detail_json=excluded.detail_json`
    )
    .run(subjectId, `+${ttl} seconds`, JSON.stringify({ endpointId, load: load ?? null }));
  return { siteId, subjectId, endpointId };
}

export function listDirectorySubjects({ groupRef: ref, kind, online } = {}) {
  let sql =
    `SELECT DISTINCT s.*,
       CASE WHEN EXISTS (
         SELECT 1 FROM presence_observations p WHERE p.subject_id = s.subject_id
           AND p.state = 'online' AND (p.expires_at IS NULL OR p.expires_at > datetime('now'))
       ) THEN 1 ELSE 0 END AS online
     FROM subjects s`;
  const params = [];
  if (ref) {
    sql += ` JOIN memberships m ON m.subject_id = s.subject_id AND m.group_ref = ? AND m.status = 'active'`;
    params.push(ref);
  }
  sql += ' WHERE 1=1';
  if (kind) {
    sql += ' AND s.kind = ?';
    params.push(kind);
  }
  if (online === true || online === 'true') sql += ` AND EXISTS (SELECT 1 FROM presence_observations p WHERE p.subject_id=s.subject_id AND p.state='online' AND (p.expires_at IS NULL OR p.expires_at > datetime('now')))`;
  sql += ' ORDER BY s.site_id, s.kind, s.display_name';
  return db().prepare(sql).all(...params).map((row) => ({ ...row, online: Boolean(row.online) }));
}

export function listDirectoryEndpoints({ capability, siteId } = {}) {
  let sql =
    `SELECT e.*, s.site_id, s.kind, s.local_id, s.display_name
     FROM endpoints e JOIN subjects s ON s.subject_id = e.subject_id WHERE 1=1`;
  const params = [];
  if (capability) {
    sql += ` AND EXISTS (SELECT 1 FROM capabilities c WHERE c.endpoint_id=e.endpoint_id AND c.name=?)`;
    params.push(capability);
  }
  if (siteId) {
    sql += ' AND s.site_id = ?';
    params.push(normalizeSiteId(siteId));
  }
  sql += ' ORDER BY s.site_id, s.display_name';
  return db().prepare(sql).all(...params).map((row) => ({
    ...row,
    labels: row.labels_json ? JSON.parse(row.labels_json) : {},
    capabilities: db().prepare(`SELECT name, version, labels_json, limits_json FROM capabilities WHERE endpoint_id=?`).all(row.endpoint_id).map((c) => ({
      name: c.name,
      version: c.version,
      labels: c.labels_json ? JSON.parse(c.labels_json) : {},
      limits: c.limits_json ? JSON.parse(c.limits_json) : {},
    })),
  }));
}

export function projectConfiguredDirectory(config, runners) {
  return writeTx((database) => {
    const out = [];
    for (const runner of runners) out.push(upsertRunnerDirectoryTx(database, config, runner));
    return out;
  });
}

export function projectWpGroupMembers(config, groupId, members = [], onlineUserIds = []) {
  const siteId = siteIdFor(config);
  const online = new Set((onlineUserIds || []).map(String));
  return writeTx((database) => {
    const ref = groupRef({ authority: siteId, groupId });
    const projected = [];
    for (const member of members) {
      const kind = member.kind === 'agent' ? 'agent' : 'user';
      const localId = kind === 'user' ? member.authUserId || member.userId || member.id : member.id;
      if (!localId) continue;
      const subjectId = upsertSubjectTx(database, {
        siteId,
        kind,
        localId,
        displayName: member.displayName || localId,
        status: member.isActive === false ? 'inactive' : 'active',
      });
      const membershipId = stableSubjectId({
        siteId,
        kind: 'service',
        localId: `membership:${ref}:${subjectId}`,
      });
      database
        .prepare(
          `INSERT INTO memberships (id, group_ref, subject_id, role, permissions_json, status, source)
           VALUES (?, ?, ?, ?, ?, ?, 'workpanel')
           ON CONFLICT(group_ref, subject_id) DO UPDATE SET role=excluded.role,
             permissions_json=excluded.permissions_json, status=excluded.status,
             source='workpanel', updated_at=datetime('now')`
        )
        .run(
          membershipId,
          ref,
          subjectId,
          member.kind === 'agent' ? 'agent' : 'member',
          JSON.stringify(member.kind === 'agent' ? ['receive', 'reply'] : ['read', 'send']),
          member.isActive === false ? 'inactive' : 'active'
        );
      const isOnline = member.kind === 'agent'
        ? member.isActive !== false
        : online.has(String(member.authUserId || '')) || online.has(String(member.userId || '')) || online.has(String(member.id || ''));
      database
        .prepare(
          `INSERT INTO presence_observations (subject_id, source, state, observed_at, expires_at, detail_json)
           VALUES (?, 'workpanel', ?, datetime('now'), datetime('now', '+90 seconds'), ?)
           ON CONFLICT(subject_id, source) DO UPDATE SET state=excluded.state,
             observed_at=datetime('now'), expires_at=excluded.expires_at, detail_json=excluded.detail_json`
        )
        .run(subjectId, isOnline ? 'online' : 'offline', JSON.stringify({ memberId: member.id, groupRef: ref }));
      projected.push({ subjectId, groupRef: ref });
    }
    return projected;
  });
}

export function newEnrollmentId() {
  return `enr_${randomUUID()}`;
}

export function listLocalFederationRoutes(config) {
  const siteId = siteIdFor(config);
  return db().prepare(
    `SELECT m.group_ref, s.subject_id, s.display_name, e.endpoint_id, e.protocol_version
     FROM subjects s JOIN memberships m ON m.subject_id=s.subject_id
     JOIN endpoints e ON e.subject_id=s.subject_id
     WHERE s.site_id=? AND s.kind='agent' AND s.status='active' AND m.status='active'
       AND e.status='active' AND e.expires_at>datetime('now')`
  ).all(siteId).map((row) => ({
    groupRef: row.group_ref,
    subjectId: row.subject_id,
    displayName: row.display_name,
    version: row.protocol_version,
    capabilities: db().prepare(`SELECT name FROM capabilities WHERE endpoint_id=?`).all(row.endpoint_id).map((x) => x.name),
  }));
}

export function importFederationRoutes(config, routes = [], ttlSec = 90) {
  const localSite = siteIdFor(config);
  return writeTx((database) => {
    database.prepare(`UPDATE endpoints SET status='withdrawn' WHERE protocol='connecter.federation'`).run();
    for (const route of routes) {
      if (!route?.groupRef || !route?.subjectId || route.siteId === localSite) continue;
      const collision = database.prepare(`SELECT site_id FROM subjects WHERE subject_id=? AND site_id!=?`).get(route.subjectId, route.siteId);
      if (collision) continue;
      database.prepare(
        `INSERT INTO subjects (subject_id, site_id, kind, local_id, display_name, status)
         VALUES (?, ?, 'agent', ?, ?, 'active')
         ON CONFLICT(subject_id) DO UPDATE SET display_name=excluded.display_name, status='active', updated_at=datetime('now')`
      ).run(route.subjectId, route.siteId, route.subjectId, route.displayName || route.subjectId);
      const endpointId = `fed_${route.siteId}_${route.subjectId}`;
      database.prepare(
        `INSERT INTO endpoints (endpoint_id, subject_id, protocol, protocol_version, runtime, status, labels_json, last_seen_at, expires_at)
         VALUES (?, ?, 'connecter.federation', ?, 'remote', 'active', ?, datetime('now'), datetime('now', ?))
         ON CONFLICT(endpoint_id) DO UPDATE SET status='active', protocol_version=excluded.protocol_version,
           labels_json=excluded.labels_json, last_seen_at=datetime('now'), expires_at=excluded.expires_at, updated_at=datetime('now')`
      ).run(endpointId, route.subjectId, Number(route.version) || 1, JSON.stringify({ targetSite: route.siteId }), `+${ttlSec} seconds`);
      database.prepare(`DELETE FROM capabilities WHERE endpoint_id=?`).run(endpointId);
      for (const name of route.capabilities || []) {
        database.prepare(`INSERT INTO capabilities (endpoint_id,name,version) VALUES (?,?,'1')`).run(endpointId, name);
      }
      const membershipId = stableSubjectId({ siteId: route.siteId, kind: 'service', localId: `federation:${route.groupRef}:${route.subjectId}` });
      database.prepare(
        `INSERT INTO memberships (id,group_ref,subject_id,role,permissions_json,status,source)
         VALUES (?, ?, ?, 'agent', '["execute","reply"]', 'active', 'federation')
         ON CONFLICT(group_ref,subject_id) DO UPDATE SET status='active', source='federation', updated_at=datetime('now')`
      ).run(membershipId, route.groupRef, route.subjectId);
    }
    return routes.length;
  });
}
