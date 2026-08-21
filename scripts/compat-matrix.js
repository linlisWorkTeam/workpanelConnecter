import assert from 'node:assert/strict';
import { parseRunnerRegistration } from '../src/relay/contracts/directory.js';
import { createFederationEnvelope, validateFederationEnvelope } from '../src/relay/contracts/federation.js';
import { groupRef, stableSubjectId } from '../src/relay/services/identityService.js';

assert.equal(parseRunnerRegistration({}, {}).protocolVersion, 1);
assert.equal(parseRunnerRegistration({ protocolVersion: 2, futureOptionalField: true }, {}).protocolVersion, 2);
assert.throws(() => parseRunnerRegistration({ protocolVersion: 3 }, {}), /unsupported/);
const envelope = createFederationEnvelope({ originSite: 'site-a', targetSite: 'site-b', groupRef: groupRef({ authority: 'site-a', groupId: 'g' }),
  fromSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'p' }), toSubject: stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'a' }),
  kind: 'chat.command', futureOptionalField: true });
assert.equal(validateFederationEnvelope({ ...envelope, futureOptionalField: true }).protocol, 'workpanel.connecter.federation/v1');
assert.throws(() => validateFederationEnvelope({ ...envelope, protocol: 'workpanel.connecter.federation/v2' }), /unsupported/);
console.log('COMPAT_MATRIX_OK runner=v1,v2 federation=v1');
