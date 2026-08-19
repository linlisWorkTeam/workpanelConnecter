/**
 * WorkPanel slot registry: static relay.json backends + outbound register/heartbeat.
 * Pet never discovers WP; Connecter owns the table (same idea as E1 runners).
 */
import { db, writeTx } from './db.js';
import { wpHealth } from '../workpanelClient.js';

export function slotHeartbeatTtlSec(config) {
  const n = Number(config?.wpSlotHeartbeatTtlSec);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function isSlotFresh(row, ttlSec = 90) {
  const ts = Number(row?.lastSeenAtMs);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const age = Date.now() - ts;
  return age >= 0 && age <= ttlSec * 1000;
}

export function isRegisteredSlotFresh(row, ttlSec = 90) {
  if (!row) return false;
  if (row.fresh === true) return true;
  if (row.fresh === false) return false;
  if (row.lastSeenAtMs) return isSlotFresh(row, ttlSec);
  const last = row.last_seen_at;
  if (!last) return false;
  try {
    const age = db()
      .prepare(
        `SELECT CAST(strftime('%s','now') - strftime('%s', ?) AS INTEGER) AS age`
      )
      .get(last);
    return Number(age?.age) >= 0 && Number(age.age) <= ttlSec;
  } catch {
    return false;
  }
}

function parseAuthJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.username) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function mergeBackendMap(staticBackends, overlays = []) {
  const out = {};
  for (const [name, backend] of Object.entries(staticBackends || {})) {
    out[name] = { ...backend, source: 'config' };
  }
  for (const overlay of overlays) {
    if (!overlay?.name || !overlay.baseUrl) continue;
    if (!isRegisteredSlotFresh(overlay)) continue;
    const prev = out[overlay.name] || {};
    out[overlay.name] = {
      kind: overlay.kind || prev.kind || 'workpanel',
      baseUrl: String(overlay.baseUrl).replace(/\/+$/, ''),
      auth: overlay.auth || prev.auth || {},
      label: overlay.label || prev.label || null,
      source: 'register',
    };
  }
  return out;
}

export function listMergedEnvs(staticBackends, overlays = []) {
  const merged = mergeBackendMap(staticBackends, overlays);
  return Object.keys(merged).map((name) => ({
    name,
    label: merged[name].label || null,
    baseUrl: merged[name].baseUrl,
    kind: merged[name].kind || 'workpanel',
    source: merged[name].source || 'config',
  }));
}

export function listFreshOverlays(config) {
  const ttl = slotHeartbeatTtlSec(config);
  try {
    const rows = db()
      .prepare(
        `SELECT name, base_url, kind, auth_json, last_seen_at FROM wp_slots`
      )
      .all();
    return rows.map((row) => ({
      name: row.name,
      baseUrl: row.base_url,
      kind: row.kind,
      auth: parseAuthJson(row.auth_json),
      last_seen_at: row.last_seen_at,
      fresh: isRegisteredSlotFresh(row, ttl),
    }));
  } catch {
    return [];
  }
}

export function backendsFor(config) {
  return mergeBackendMap(config?.backends || {}, listFreshOverlays(config));
}

export async function probeWpHealth(baseUrl, { timeoutMs = 2000 } = {}) {
  try {
    return await wpHealth({ baseUrl }, { timeoutMs });
  } catch {
    return false;
  }
}

export async function annotateAlive(envs, { timeoutMs = 2000 } = {}) {
  return Promise.all(
    (envs || []).map(async (row) => ({
      ...row,
      alive: await probeWpHealth(row.baseUrl, { timeoutMs }),
    }))
  );
}

export async function upsertWpSlot({ name, baseUrl, kind, auth }) {
  const id = String(name || '').trim();
  const url = String(baseUrl || '').replace(/\/+$/, '');
  if (!id) {
    const err = new Error('name required');
    err.code = 'BAD_SLOT';
    throw err;
  }
  if (!/^https?:\/\//i.test(url)) {
    const err = new Error('baseUrl must be http(s)');
    err.code = 'BAD_SLOT';
    throw err;
  }
  if (id === 'prod') {
    const err = new Error('cannot register prod slot');
    err.code = 'PROD_FORBIDDEN';
    throw err;
  }
  const slotKind = kind || 'workpanel';
  let authJson = null;
  if (auth?.username) {
    authJson = JSON.stringify({
      username: auth.username,
      password: auth.password || '',
    });
  }
  await writeTx((database) => {
    database
      .prepare(
        `INSERT INTO wp_slots (name, base_url, kind, auth_json, last_seen_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
           base_url = excluded.base_url,
           kind = excluded.kind,
           auth_json = COALESCE(excluded.auth_json, wp_slots.auth_json),
           last_seen_at = datetime('now')`
      )
      .run(id, url, slotKind, authJson);
  });
  return { name: id, baseUrl: url, kind: slotKind };
}

export async function touchWpSlot(name) {
  const id = String(name || '').trim();
  if (!id) {
    const err = new Error('name required');
    err.code = 'BAD_SLOT';
    throw err;
  }
  const row = db().prepare(`SELECT name FROM wp_slots WHERE name = ?`).get(id);
  if (!row) {
    const err = new Error('slot not registered');
    err.code = 'UNKNOWN_SLOT';
    throw err;
  }
  await writeTx((database) => {
    database.prepare(`UPDATE wp_slots SET last_seen_at = datetime('now') WHERE name = ?`).run(id);
  });
  return { name: id, ok: true };
}
