#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveBackend, listEnvs } from '../src/relay/router.js';
import { checkBearer, extractBearer } from '../src/relay/auth.js';

const config = {
  allowProdFromPet: false,
  defaults: { env: 'canary', group: '灰度测试' },
  backends: {
    canary: { baseUrl: 'http://127.0.0.1:8081', kind: 'workpanel' },
    prod: { baseUrl: 'http://127.0.0.1:8080', kind: 'workpanel' },
  },
  auth: { tokens: ['tok-a'] },
};

assert.equal(resolveBackend(config, null).env, 'canary');
assert.equal(resolveBackend(config, 'canary').backend.baseUrl.includes('8081'), true);

let threw = false;
try {
  resolveBackend(config, 'prod', { client: 'pet' });
} catch (e) {
  threw = e.code === 'PROD_FORBIDDEN';
}
assert.equal(threw, true);

assert.equal(resolveBackend(config, 'prod', { client: 'ops' }).env, 'prod');

threw = false;
try {
  resolveBackend(config, 'nope');
} catch (e) {
  threw = e.code === 'UNKNOWN_ENV';
}
assert.equal(threw, true);

assert.deepEqual(
  listEnvs(config).map((e) => e.name).sort(),
  ['canary', 'prod']
);

assert.equal(extractBearer({ headers: { authorization: 'Bearer tok-a' } }), 'tok-a');
assert.equal(checkBearer({ headers: { authorization: 'Bearer tok-a' } }, config).ok, true);
assert.equal(checkBearer({ headers: {} }, config).ok, false);
assert.equal(checkBearer({ headers: { authorization: 'Bearer bad' } }, config).ok, false);

console.log('RELAY_UNIT_OK');
