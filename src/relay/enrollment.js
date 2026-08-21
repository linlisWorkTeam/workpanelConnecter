import { randomUUID } from 'node:crypto';
import { db, writeTx } from './db.js';
import { hashToken } from './registry.js';
import { normalizeSiteId } from './services/identityService.js';
import { upsertSubjectTx } from './directory.js';
import { issueCredentialTx, normalizeScopes } from './credentialStore.js';

export function createEnrollment(config, body = {}) {
  const code = String(body.code || '');
  const configured = config?.enrollment?.codes || [];
  if (!code || !configured.includes(code)) {
    return Promise.resolve({ status: 403, body: { error: 'invalid enrollment code', code: 'INVALID_ENROLLMENT_CODE' } });
  }
  let siteId;
  try {
    siteId = normalizeSiteId(body.siteId || config?.host?.siteId || config?.siteId || 'local');
  } catch (error) {
    return Promise.resolve({ status: 400, body: { error: error.message } });
  }
  const kind = String(body.kind || 'agent');
  const localId = String(body.agentId || body.localId || '').trim();
  if (kind !== 'agent' || !localId) {
    return Promise.resolve({ status: 400, body: { error: 'agent localId required', code: 'INVALID_ENROLLMENT' } });
  }
  const id = `enr_${randomUUID()}`;
  return writeTx((database) => {
    try {
      database
        .prepare(
          `INSERT INTO enrollment_requests
           (id, code_hash, site_id, kind, local_id, display_name, public_key, metadata_json, requested_scopes_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          hashToken(code),
          siteId,
          kind,
          localId,
          body.displayName || localId,
          body.publicKey || null,
          JSON.stringify(body.metadata || {}),
          JSON.stringify(normalizeScopes(body.requestedScopes || {}))
        );
    } catch (error) {
      if (String(error.message || error).includes('UNIQUE')) {
        return { status: 409, body: { error: 'enrollment code already used', code: 'ENROLLMENT_CODE_USED' } };
      }
      throw error;
    }
    return { status: 202, body: { enrollmentId: id, status: 'pending' } };
  });
}

export function listEnrollments({ status } = {}) {
  let sql = `SELECT * FROM enrollment_requests`;
  const params = [];
  if (status) {
    sql += ' WHERE status=?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  return db().prepare(sql).all(...params).map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata_json || '{}'),
    requestedScopes: normalizeScopes(JSON.parse(row.requested_scopes_json || '{}')),
  }));
}

export function approveEnrollment(config, enrollmentId, body = {}, reviewer = 'ops') {
  return writeTx((database) => {
    const request = database.prepare(`SELECT * FROM enrollment_requests WHERE id=?`).get(enrollmentId);
    if (!request) return { status: 404, body: { error: 'enrollment not found' } };
    if (request.status !== 'pending') return { status: 409, body: { error: `enrollment already ${request.status}` } };
    const subjectId = upsertSubjectTx(database, {
      siteId: request.site_id,
      kind: request.kind,
      localId: request.local_id,
      displayName: request.display_name,
    });
    const requested = normalizeScopes(JSON.parse(request.requested_scopes_json || '{}'));
    const scopes = normalizeScopes(body.scopes || requested);
    const credential = issueCredentialTx(database, {
      subjectId,
      publicKey: request.public_key,
      scopes,
      ttlSec: body.ttlSec || config?.enrollment?.credentialTtlSec,
    });
    database
      .prepare(`UPDATE enrollment_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`)
      .run(reviewer, enrollmentId);
    return {
      status: 200,
      body: {
        enrollmentId,
        status: 'approved',
        agentId: request.local_id,
        credential,
      },
    };
  });
}

export function rejectEnrollment(enrollmentId, reviewer = 'ops') {
  const result = db()
    .prepare(`UPDATE enrollment_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now') WHERE id=? AND status='pending'`)
    .run(reviewer, enrollmentId);
  return result.changes === 1
    ? { status: 200, body: { enrollmentId, status: 'rejected' } }
    : { status: 404, body: { error: 'pending enrollment not found' } };
}

export function rotateCredential(config, credential) {
  return writeTx((database) => {
    const current = database.prepare(`SELECT * FROM device_credentials WHERE id=? AND status='active'`).get(credential.id);
    if (!current) return { status: 409, body: { error: 'credential is not active' } };
    const next = issueCredentialTx(database, {
      subjectId: current.subject_id,
      publicKey: current.public_key,
      scopes: JSON.parse(current.scopes_json || '{}'),
      ttlSec: config?.enrollment?.credentialTtlSec,
      rotatedFrom: current.id,
    });
    database.prepare(`UPDATE device_credentials SET status='rotated', revoked_at=datetime('now') WHERE id=?`).run(current.id);
    database.prepare(`UPDATE runners SET token_hash=? WHERE id=?`).run(hashToken(next.token), credential.local_id);
    return { status: 200, body: { credential: next } };
  });
}
