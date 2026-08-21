import assert from 'node:assert/strict';
import { groupRef, newTraceContext, normalizeSiteId, parseGroupRef, stableSubjectId } from '../src/relay/services/identityService.js';
import { auditContext, redactAuditDetails } from '../src/relay/services/auditService.js';

assert.equal(normalizeSiteId(' Site-A '), 'site-a');
assert.throws(() => normalizeSiteId('bad_site'), /invalid siteId/);
const first = stableSubjectId({ siteId: 'site-a', kind: 'agent', localId: 'agent-1' });
const same = stableSubjectId({ siteId: 'site-a', kind: 'agent', localId: 'agent-1' });
const otherSite = stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'agent-1' });
assert.equal(first, same);
assert.notEqual(first, otherSite);
const ref = groupRef({ authority: 'site-a', groupId: 'group/一' });
assert.deepEqual(parseGroupRef(ref), { authority: 'site-a', groupId: 'group/一' });
const trace = newTraceContext();
assert.match(trace.traceId, /^[0-9a-f-]{36}$/);
const audit = auditContext({ siteId: 'site-a', subjectId: first, operation: 'dispatch' });
assert.equal(audit.operation, 'dispatch');
assert.deepEqual(redactAuditDetails({ token: 'secret', messageId: 'm1' }), {
  token: '[REDACTED]', messageId: 'm1',
});
console.log('IDENTIFIERS_UNIT_OK');
