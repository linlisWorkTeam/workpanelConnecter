import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listenRelay, closeDb } from '../src/relay/server.js';
import { groupRef } from '../src/relay/services/identityService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-directory-api-'));
const port = 9114;
const opsToken = 'directory-ops';
const runnerToken = 'directory-runner';
const runnerV1Token = 'directory-runner-v1';
const petToken = 'directory-pet';
const ref = groupRef({ authority: 'site-a', groupId: 'group-a' });
const configPath = path.join(root, 'relay.json');
const dbPath = path.join(root, 'connector.db');
fs.writeFileSync(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port }, db: { path: dbPath },
  host: { role: 'standalone', siteId: 'site-a' }, auth: { tokens: [opsToken] },
  runners: [{
    agentId: 'runner-a', displayName: 'Reviewer', token: runnerToken, protocolVersion: 2,
    capabilities: ['code.review'], maxConcurrency: 2,
    bindings: [{ env: 'canary', groupId: 'group-a', groupRef: ref, agentName: 'Reviewer' }],
  }, {
    agentId: 'runner-v1', token: runnerV1Token,
    bindings: [{ env: 'canary', groupId: 'group-v1', agentName: 'Legacy Agent' }],
  }],
  pets: [{ id: 'pet-a', name: 'Pet', token: petToken, groups: [] }], backends: {},
}));

async function call(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

const boot = await listenRelay({ configPath, dbPath, resume: false });
try {
  const registered = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'runner-a', token: runnerToken, protocolVersion: 2 }),
  });
  assert.equal(registered.status, 200);
  const registeredV1 = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'runner-v1', token: runnerV1Token }),
  });
  assert.equal(registeredV1.status, 200);
  assert.equal(registeredV1.body.protocolVersion, 1);
  const runnerHeaders = { authorization: `Bearer ${runnerToken}`, 'content-type': 'application/json' };
  await call('/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' });
  const opsHeaders = { authorization: `Bearer ${opsToken}` };
  const petHeaders = { authorization: `Bearer ${petToken}` };
  assert.equal((await call('/v2/directory/endpoints', { headers: petHeaders })).status, 403);
  const subjects = await call(`/v2/directory/subjects?groupRef=${encodeURIComponent(ref)}&online=true`, { headers: opsHeaders });
  assert.equal(subjects.status, 200);
  assert.equal(subjects.body.subjects.length, 1);
  const endpoints = await call('/v2/directory/endpoints?capability=code.review&siteId=site-a', { headers: opsHeaders });
  assert.equal(endpoints.body.endpoints.length, 1);
  assert.equal(endpoints.body.endpoints[0].max_concurrency, 2);
  const legacy = await call('/v1/agents?group=group-a', { headers: opsHeaders });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.agents[0].agent_name, 'Reviewer');
  const legacyV1 = await call('/v1/agents?group=group-v1', { headers: opsHeaders });
  assert.equal(legacyV1.body.agents[0].agent_name, 'Legacy Agent');
  const explained = await call(
    `/v2/routes/explain?groupRef=${encodeURIComponent(ref)}&agentName=Reviewer&sourceSiteId=site-a&capability=code.review`,
    { headers: opsHeaders }
  );
  assert.equal(explained.status, 200);
  assert.equal(explained.body.decision.target.localId, 'runner-a');
  console.log('DIRECTORY_API_UNIT_OK');
} finally {
  await new Promise((resolve) => boot.server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
