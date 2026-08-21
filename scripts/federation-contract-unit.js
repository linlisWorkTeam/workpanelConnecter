import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFederationEnvelope, validateFederationEnvelope } from '../src/relay/contracts/federation.js';
import { stableSubjectId, groupRef } from '../src/relay/services/identityService.js';

const envelope = createFederationEnvelope({
  originSite: 'site-a', targetSite: 'site-b', groupRef: groupRef({ authority: 'site-a', groupId: 'group-1' }),
  fromSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'pet-a' }),
  toSubject: stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'runner-b' }),
  kind: 'chat.command', payload: { content: 'hello' }, correlationId: randomUUID(),
});
assert.equal(validateFederationEnvelope(envelope).messageId, envelope.messageId);
assert.throws(() => validateFederationEnvelope({ ...envelope, targetSite: '../bad' }), /invalid federation site/);
assert.throws(() => validateFederationEnvelope({ ...envelope, expiresAt: new Date(Date.now() - 1).toISOString() }), /expired|timestamps/);
assert.throws(() => validateFederationEnvelope({ ...envelope, payload: { data: 'x'.repeat(132000) } }), /too large/);
assert.throws(() => validateFederationEnvelope({ ...envelope, messageId: 'not-uuid' }), /UUID/);
console.log('FEDERATION_CONTRACT_UNIT_OK');
