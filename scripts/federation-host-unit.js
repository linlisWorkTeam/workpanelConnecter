import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, db } from '../src/relay/db.js';
import { registerHostPeer, findHostPeerByToken } from '../src/relay/hostPeers.js';
import { createFederationEnvelope } from '../src/relay/contracts/federation.js';
import { stableSubjectId, groupRef } from '../src/relay/services/identityService.js';
import { signFederationEnvelope } from '../src/relay/envelopeSignature.js';
import { acceptFederationMessage, pullFederationMessages, ackFederationMessage, completeFederationMessage, advertiseFederationRoutes, listFederationRoutes } from '../src/relay/federationHost.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-fed-host-'));
process.env.CONNECTER_TEST_HOST_SIGN_A = 'sign-secret-a';
const config = { host: { role: 'host', peers: [{ siteId: 'site-a', token: 'token-a', keys: [{ keyId: 'sign-a', secretEnv: 'CONNECTER_TEST_HOST_SIGN_A', status: 'active' }] }, { siteId: 'site-b', token: 'token-b' }] }, federation: { leaseSec: 2, requireSignatures: true, requireSeparateSigningKey: true, requireExternalSigningKey: true, policies: [{ originSite: 'site-a', targetSite: 'site-b', groupRef: 'wp:site-a:group-1', subjectId: '*', operation: '*', direction: '*', effect: 'allow', version: 'host-unit/v1' }], quotas: { maxConcurrentPulls: 1 } } };
openDb(path.join(root, 'host.db'));
try {
  await registerHostPeer(config, { siteId: 'site-a', token: 'token-a' });
  await registerHostPeer(config, { siteId: 'site-b', token: 'token-b' });
  const peerA = findHostPeerByToken('token-a');
  const peerB = findHostPeerByToken('token-b');
  const ref = groupRef({ authority: 'site-a', groupId: 'group-1' });
  const subjectB = stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'runner-b' });
  const unsigned = createFederationEnvelope({ originSite: 'site-a', targetSite: 'site-b', groupRef: ref,
    fromSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'pet-a' }), toSubject: subjectB,
    kind: 'chat.command', payload: { content: 'hello' } });
  assert.equal((await acceptFederationMessage(config, peerA, unsigned)).status, 401);
  const envelope = signFederationEnvelope(unsigned, { keyId: 'sign-a', secret: 'sign-secret-a' });
  assert.equal((await acceptFederationMessage(config, peerA, envelope)).status, 202);
  assert.equal((await acceptFederationMessage(config, peerA, envelope)).body.duplicate, true);
  const conflict = signFederationEnvelope({ ...envelope, signature: null, payload: { content: 'conflict' } }, { keyId: 'sign-a', secret: 'sign-secret-a' });
  assert.equal((await acceptFederationMessage(config, peerA, conflict)).status, 409);
  assert.equal((await acceptFederationMessage(config, peerB, envelope)).status, 403);
  const pulled = await pullFederationMessages(config, peerB, { limit: 1 });
  assert.equal(pulled.body.messages.length, 1);
  const leaseToken = pulled.body.messages[0].leaseToken;
  const lease = { originSite: 'site-a', messageId: envelope.messageId, leaseToken };
  assert.equal((await ackFederationMessage(config, peerB, lease)).body.status, 'acknowledged');
  assert.equal((await ackFederationMessage(config, peerB, lease)).body.duplicate, true);
  assert.equal((await completeFederationMessage(config, peerB, { ...lease, status: 'delivered' })).body.status, 'delivered');
  assert.equal((await completeFederationMessage(config, peerB, { ...lease, status: 'delivered' })).body.duplicate, true);

  const ackLossEnvelope = signFederationEnvelope(createFederationEnvelope({
    originSite: 'site-a', targetSite: 'site-b', groupRef: ref,
    fromSubject: unsigned.fromSubject, toSubject: subjectB, kind: 'chat.command', payload: { content: 'ack-loss' },
  }), { keyId: 'sign-a', secret: 'sign-secret-a' });
  await acceptFederationMessage(config, peerA, ackLossEnvelope);
  const firstAttempt = (await pullFederationMessages(config, peerB, { limit: 1 })).body.messages[0];
  assert.equal(firstAttempt.attempt, 1);
  db().prepare(`UPDATE federation_deliveries SET lease_until=datetime('now','-1 second') WHERE federation_id=(SELECT id FROM federation_messages WHERE message_id=?)`).run(ackLossEnvelope.messageId);
  const secondAttempt = (await pullFederationMessages(config, peerB, { limit: 1 })).body.messages[0];
  assert.equal(secondAttempt.envelope.messageId, ackLossEnvelope.messageId);
  assert.equal(secondAttempt.attempt, 2);
  const recoveredLease = { originSite: 'site-a', messageId: ackLossEnvelope.messageId, leaseToken: secondAttempt.leaseToken };
  await ackFederationMessage(config, peerB, recoveredLease);
  await completeFederationMessage(config, peerB, { ...recoveredLease, status: 'delivered' });

  const expiringEnvelope = signFederationEnvelope(createFederationEnvelope({
    originSite: 'site-a', targetSite: 'site-b', groupRef: ref, ttlSec: 10,
    fromSubject: unsigned.fromSubject, toSubject: subjectB, kind: 'chat.command', payload: { content: 'expires' },
  }), { keyId: 'sign-a', secret: 'sign-secret-a' });
  await acceptFederationMessage(config, peerA, expiringEnvelope);
  db().prepare(`UPDATE federation_messages SET expires_at=datetime('now','-1 second') WHERE message_id=?`).run(expiringEnvelope.messageId);
  assert.equal((await pullFederationMessages(config, peerB, { limit: 1 })).body.messages.length, 0);
  assert.equal(db().prepare(`SELECT status FROM federation_deliveries WHERE federation_id=(SELECT id FROM federation_messages WHERE message_id=?)`).get(expiringEnvelope.messageId).status, 'expired');
  await advertiseFederationRoutes(config, peerB, { routes: [{ groupRef: ref, subjectId: subjectB, displayName: 'DeepSeek', capabilities: ['chat'] }] });
  assert.equal(listFederationRoutes(config, peerA, { groupRef: ref }).body.routes[0].siteId, 'site-b');
  const waiting = pullFederationMessages(config, peerB, { waitMs: 300 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await pullFederationMessages(config, peerB, { waitMs: 1 })).status, 429);
  await waiting;
  console.log('FEDERATION_HOST_UNIT_OK');
} finally { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
