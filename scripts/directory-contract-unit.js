import assert from 'node:assert/strict';
import { parseCapabilities, parseRunnerRegistration } from '../src/relay/contracts/directory.js';

assert.deepEqual(parseCapabilities(['code.review'])[0], {
  name: 'code.review', version: '1', labels: {}, limits: {},
});
const parsed = parseRunnerRegistration({
  protocolVersion: 2,
  maxConcurrency: 3,
  load: 0.5,
  labels: { region: 'hk' },
  capabilities: [{ name: 'Code.Review', version: '2' }],
});
assert.equal(parsed.protocolVersion, 2);
assert.equal(parsed.maxConcurrency, 3);
assert.equal(parsed.capabilities[0].name, 'code.review');
assert.throws(() => parseRunnerRegistration({ protocolVersion: 3 }), /unsupported/);
assert.throws(() => parseRunnerRegistration({ maxConcurrency: 0 }), /maxConcurrency/);
assert.throws(() => parseCapabilities(['bad capability']), /invalid capability/);
console.log('DIRECTORY_CONTRACT_UNIT_OK');
