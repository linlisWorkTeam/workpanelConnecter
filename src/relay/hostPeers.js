/**
 * Connecter Host peer registry: site Connecters join outbound (NAT-friendly).
 * Host does not talk to WorkPet or WorkPanel.
 */
import { db, writeTx } from './db.js';
import { hashToken } from './registry.js';

export function hostPeerTtlSec(config) {
  const n = Number(config?.host?.peerHeartbeatTtlSec);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function hostRole(config) {
  const h = config?.host;
  if (!h || typeof h !== 'object') return 'standalone';
  if (h.role === 'host') return 'host';
  if (h.role === 'connecter') return 'connecter';
  if (Array.isArray(h.peers) && h.peers.length && !h.baseUrl) return 'host';
  if (h.baseUrl) return 'connecter';
  return 'standalone';
}

export function provisionedHostPeer(config, siteId) {
  const id = String(siteId || '').trim();
  return (config?.host?.peers || []).find((p) => p && p.siteId === id) || null;
}

export function isHostPeerFresh(row, ttlSec = 90) {
  const last = row?.last_seen_at;
  if (!last) return false;
  const age = db()
    .prepare(`SELECT CAST(strftime('%s','now') - strftime('%s', ?) AS INTEGER) AS age`)
    .get(last);
  return Number(age?.age) >= 0 && Number(age.age) <= ttlSec;
}

export function findHostPeerByToken(token) {
  const tokenHash = hashToken(token);
  return db().prepare('SELECT * FROM connecter_peers WHERE token_hash = ?').get(tokenHash) || null;
}

export function registerHostPeer(config, body = {}) {
  const siteId = String(body.siteId || body.id || '').trim();
  const token = String(body.token || '');
  if (!siteId || !token) {
    return Promise.resolve({ status: 400, body: { error: 'siteId and token required' } });
  }
  if (hostRole(config) !== 'host') {
    return Promise.resolve({ status: 403, body: { error: 'this process is not Connecter Host' } });
  }
  const provisioned = provisionedHostPeer(config, siteId);
  if (!provisioned) {
    return Promise.resolve({ status: 403, body: { error: 'siteId not provisioned' } });
  }
  if (provisioned.token !== token) {
    return Promise.resolve({ status: 401, body: { error: 'token mismatch' } });
  }
  const label = String(body.label || provisioned.label || siteId).trim();
  const publicBaseUrl = String(body.publicBaseUrl || body.baseUrl || '').replace(/\/+$/, '') || null;
  return writeTx((database) => {
    database
      .prepare(
        `INSERT INTO connecter_peers (site_id, token_hash, label, public_base_url, status, last_seen_at)
         VALUES (?, ?, ?, ?, 'active', datetime('now'))
         ON CONFLICT(site_id) DO UPDATE SET
           token_hash = excluded.token_hash,
           label = excluded.label,
           public_base_url = COALESCE(excluded.public_base_url, connecter_peers.public_base_url),
           status = 'active',
           last_seen_at = datetime('now')`
      )
      .run(siteId, hashToken(token), label, publicBaseUrl);
    return {
      status: 200,
      body: { ok: true, siteId, role: 'connecter', host: true },
    };
  });
}

export function heartbeatHostPeer(peer) {
  if (!peer?.site_id) {
    return { status: 403, body: { error: 'peer token required' } };
  }
  db()
    .prepare(
      `UPDATE connecter_peers SET last_seen_at = datetime('now'), status = 'active' WHERE site_id = ?`
    )
    .run(peer.site_id);
  return { status: 200, body: { ok: true, siteId: peer.site_id } };
}

export function listHostPeers(config) {
  const ttl = hostPeerTtlSec(config);
  const rows = db()
    .prepare(
      `SELECT site_id, label, public_base_url, status, last_seen_at FROM connecter_peers ORDER BY site_id`
    )
    .all();
  return rows.map((row) => ({
    siteId: row.site_id,
    label: row.label,
    publicBaseUrl: row.public_base_url,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    linked: isHostPeerFresh(row, ttl),
  }));
}
