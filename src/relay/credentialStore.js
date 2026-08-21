import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { hashToken } from './registry.js';

export function normalizeScopes(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const list = (name) => Array.from(new Set((Array.isArray(input[name]) ? input[name] : []).map(String)));
  return {
    sites: list('sites'),
    groups: list('groups'),
    capabilities: list('capabilities').map((item) => item.toLowerCase()),
    operations: list('operations'),
  };
}

export function findCredentialByToken(token) {
  const row = db()
    .prepare(
      `SELECT c.*, s.site_id, s.kind, s.local_id, s.display_name
       FROM device_credentials c JOIN subjects s ON s.subject_id=c.subject_id
       WHERE c.token_hash=? AND c.status='active'
         AND (c.expires_at IS NULL OR c.expires_at > datetime('now'))`
    )
    .get(hashToken(token));
  return row ? { ...row, scopes: normalizeScopes(JSON.parse(row.scopes_json || '{}')) } : null;
}

export function findCredentialForRunnerToken(token, agentId) {
  const credential = findCredentialByToken(token);
  if (!credential || credential.kind !== 'agent' || credential.local_id !== agentId) return null;
  return credential;
}

export function issueCredentialTx(
  database,
  { subjectId, publicKey = null, scopes = {}, ttlSec = 2592000, rotatedFrom = null }
) {
  const id = `cred_${randomUUID()}`;
  const keyId = `key_${randomUUID()}`;
  const token = `device_${randomUUID()}_${randomUUID()}`;
  const ttl = Number(ttlSec) > 0 ? Math.min(Math.floor(Number(ttlSec)), 31536000) : 2592000;
  database
    .prepare(
      `INSERT INTO device_credentials
       (id, subject_id, token_hash, key_id, public_key, scopes_json, status, expires_at, rotated_from)
       VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now', ?), ?)`
    )
    .run(id, subjectId, hashToken(token), keyId, publicKey, JSON.stringify(normalizeScopes(scopes)), `+${ttl} seconds`, rotatedFrom);
  return { id, keyId, token, subjectId, scopes: normalizeScopes(scopes), expiresInSec: ttl };
}

export function credentialAllowsRegistration(credential, { siteId, groupRefs = [], capabilities = [] }) {
  if (!credential) return false;
  const scopes = credential.scopes || normalizeScopes(JSON.parse(credential.scopes_json || '{}'));
  if (scopes.sites.length && !scopes.sites.includes(siteId)) return false;
  if (scopes.groups.length && groupRefs.some((ref) => !scopes.groups.includes(ref))) return false;
  if (scopes.capabilities.length && capabilities.some((name) => !scopes.capabilities.includes(String(name).toLowerCase()))) return false;
  return scopes.operations.length === 0 || scopes.operations.includes('runner.register');
}

export function revokeCredential(credentialId) {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database
      .prepare(
        `SELECT c.*, s.kind, s.local_id FROM device_credentials c
         JOIN subjects s ON s.subject_id=c.subject_id WHERE c.id=? AND c.status='active'`
      )
      .get(credentialId);
    if (!row) {
      database.exec('ROLLBACK');
      return null;
    }
    database
      .prepare(`UPDATE device_credentials SET status='revoked', revoked_at=datetime('now') WHERE id=?`)
      .run(credentialId);
    if (row.kind === 'agent') {
      database.prepare(`UPDATE runners SET status='disabled' WHERE id=?`).run(row.local_id);
    }
    database.exec('COMMIT');
    return row;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
