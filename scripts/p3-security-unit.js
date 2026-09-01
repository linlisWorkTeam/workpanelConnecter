import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, db } from '../src/relay/db.js';
import { createFederationEnvelope } from '../src/relay/contracts/federation.js';
import { groupRef, stableSubjectId } from '../src/relay/services/identityService.js';
import { signFederationEnvelope, verifyFederationEnvelopeSignature } from '../src/relay/envelopeSignature.js';
import { authorizeFederation } from '../src/relay/accessPolicy.js';
import { appendAudit } from '../src/relay/auditLog.js';
import { checkFederationQuota, resetQuotaWindowsForTest } from '../src/relay/quotas.js';
import { enforceRetention } from '../src/relay/retention.js';
import { listFederationOutbox, requeueFederationOutbox } from '../src/relay/federationSite.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-p3-security-'));
openDb(path.join(root, 'security.db'));
try {
  const ref = groupRef({ authority: 'site-a', groupId: 'g1' });
  const envelope = createFederationEnvelope({ originSite: 'site-a', targetSite: 'site-b', groupRef: ref,
    fromSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'p1' }),
    toSubject: stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'r1' }), kind: 'chat.command' });
  const signed = signFederationEnvelope(envelope, { keyId: 'active', secret: 'secret-a' });
  assert.equal(verifyFederationEnvelopeSignature(signed, [{ keyId: 'active', secret: 'secret-a' }]), true);
  const jsonRoundTrip = JSON.parse(JSON.stringify(signFederationEnvelope(
    { ...envelope, payload: { content: 'round-trip', optional: undefined } },
    { keyId: 'active', secret: 'secret-a' }
  )));
  assert.equal(verifyFederationEnvelopeSignature(jsonRoundTrip, [{ keyId: 'active', secret: 'secret-a' }]), true);
  assert.equal(verifyFederationEnvelopeSignature({ ...signed, payload: { changed: true } }, [{ keyId: 'active', secret: 'secret-a' }]), false);
  assert.equal(verifyFederationEnvelopeSignature(signed, [{ keyId: 'active', secret: 'old', status: 'revoked' }]), false);
  const nextSigned = signFederationEnvelope(envelope, { keyId: 'next', secret: 'secret-next' });
  assert.equal(verifyFederationEnvelopeSignature(nextSigned, [{ keyId: 'active', secret: 'secret-a' }, { keyId: 'next', secret: 'secret-next', status: 'next' }]), true);

  assert.equal(authorizeFederation({}, { originSite: 'site-a', targetSite: 'site-b', groupRef: ref, subjectId: signed.toSubject, operation: signed.kind }).allowed, false);
  db().prepare(`INSERT INTO federation_policies (id,origin_site,target_site,group_ref,operation,effect,version) VALUES ('allow-1','site-a','site-b',?,'chat.command','allow','policy-test/v1')`).run(ref);
  assert.equal(authorizeFederation({}, { originSite: 'site-a', targetSite: 'site-b', groupRef: ref, subjectId: signed.toSubject, operation: signed.kind }).allowed, true);
  assert.equal(authorizeFederation({}, { originSite: 'site-a', targetSite: 'site-b', groupRef: ref, subjectId: signed.toSubject, operation: 'admin' }).allowed, false);

  appendAudit({ eventType: 'credential.test', outcome: 'deny', detail: { token: 'secret', safe: 'ok' } });
  const audit = db().prepare(`SELECT * FROM audit_events`).get();
  assert.equal(JSON.parse(audit.detail_json).token, '[REDACTED]');
  assert.throws(() => db().prepare(`DELETE FROM audit_events`).run(), /append-only/);

  resetQuotaWindowsForTest();
  const quotaConfig = { federation: { quotas: { requestsPerMinute: 1 } } };
  assert.equal(checkFederationQuota(quotaConfig, 'site-b').allowed, true);
  assert.equal(checkFederationQuota(quotaConfig, 'site-b').reason, 'SITE_RATE_LIMIT');
  db().prepare(`INSERT INTO telemetry_events (event_name,created_at) VALUES ('old',datetime('now','-30 days'))`).run();
  db().prepare(`INSERT INTO audit_events (event_type,outcome,created_at) VALUES ('old.audit','allow',datetime('now','-120 days'))`).run();
  await enforceRetention({ retention: { telemetryDays: 7, auditDays: 30 } });
  assert.equal(db().prepare(`SELECT COUNT(*) n FROM telemetry_events WHERE event_name='old'`).get().n, 0);
  assert.equal(db().prepare(`SELECT COUNT(*) n FROM audit_events WHERE event_type='old.audit'`).get().n, 0);
  assert.equal(db().prepare(`SELECT COUNT(*) n FROM audit_events_archive WHERE event_type='old.audit'`).get().n, 1);
  assert.throws(() => db().prepare(`DELETE FROM audit_events_archive`).run(), /append-only/);
  db().prepare(`INSERT INTO federation_outbox (id,origin_site,message_id,target_site,envelope_json,status) VALUES ('dead-1','site-a','message-1','site-b','{}','dead')`).run();
  assert.equal(listFederationOutbox({ status: 'dead' }).length, 1);
  assert.equal((await requeueFederationOutbox('dead-1')).body.status, 'queued');
  console.log('P3_SECURITY_UNIT_OK');
} finally { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
