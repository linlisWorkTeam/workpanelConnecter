import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupRef } from '../src/relay/services/identityService.js';
import { listenRelay, closeDb } from '../src/relay/server.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-enrollment-'));
const port = 9113;
const opsToken = 'enrollment-ops';
const configPath = path.join(root, 'relay.json');
const dbPath = path.join(root, 'connector.db');
const allowedGroup = groupRef({ authority: 'site-a', groupId: 'group-a' });
fs.writeFileSync(
  configPath,
  JSON.stringify({
    listen: { host: '127.0.0.1', port },
    db: { path: dbPath },
    host: { role: 'standalone', siteId: 'site-a' },
    auth: { tokens: [opsToken] },
    enrollment: { codes: ['join-once', 'reject-once'], credentialTtlSec: 3600, requireDeviceCredentials: true },
    runners: [{ agentId: 'legacy-static', token: 'legacy-static-token', bindings: [
      { env: 'canary', groupId: 'group-a', agentName: 'Legacy' },
    ] }], pets: [], backends: {},
  })
);

async function call(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

const boot = await listenRelay({ configPath, dbPath, resume: false });
try {
  const staticDenied = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'legacy-static', token: 'legacy-static-token' }),
  });
  assert.equal(staticDenied.status, 403);
  assert.equal(staticDenied.body.code, 'DEVICE_CREDENTIAL_REQUIRED');
  const enroll = await call('/v2/enrollments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'join-once', siteId: 'site-a', agentId: 'dynamic-runner', displayName: 'Dynamic',
      publicKey: 'test-public-key',
      requestedScopes: {
        sites: ['site-a'], groups: [allowedGroup], capabilities: ['code.review'], operations: ['runner.register'],
      },
    }),
  });
  assert.equal(enroll.status, 202);
  const reused = await call('/v2/enrollments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'join-once', siteId: 'site-a', agentId: 'another' }),
  });
  assert.equal(reused.status, 409);

  const opsHeaders = { authorization: `Bearer ${opsToken}`, 'content-type': 'application/json' };
  const listed = await call('/v2/ops/enrollments?status=pending', { headers: opsHeaders });
  assert.equal(listed.body.enrollments.length, 1);
  const approved = await call(`/v2/ops/enrollments/${enroll.body.enrollmentId}/approve`, {
    method: 'POST', headers: opsHeaders, body: '{}',
  });
  assert.equal(approved.status, 200);
  const token = approved.body.credential.token;
  assert(token.startsWith('device_'));

  const deniedGroup = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: 'dynamic-runner', token, protocolVersion: 2,
      capabilities: ['code.review'], groups: [{ groupId: 'other-group', agentName: 'Dynamic' }],
    }),
  });
  assert.equal(deniedGroup.status, 403);

  const deniedCapability = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: 'dynamic-runner', token, protocolVersion: 2,
      capabilities: ['image.generate'], groups: [{ groupId: 'group-a', agentName: 'Dynamic' }],
    }),
  });
  assert.equal(deniedCapability.status, 403);

  const registered = await call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: 'dynamic-runner', token, protocolVersion: 2, maxConcurrency: 2,
      capabilities: ['code.review'], groups: [{ groupId: 'group-a', agentName: 'Dynamic' }],
    }),
  });
  assert.equal(registered.status, 200);
  assert.equal(registered.body.protocolVersion, 2);
  assert(registered.body.subjectId && registered.body.endpointId);

  const runnerHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  assert.equal((await call('/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{"load":0.2}' })).status, 200);
  const endpoints = await call('/v2/directory/endpoints?capability=code.review', { headers: opsHeaders });
  assert.equal(endpoints.body.endpoints.length, 1);

  const rotated = await call('/v2/credentials/rotate', { method: 'POST', headers: runnerHeaders, body: '{}' });
  assert.equal(rotated.status, 200);
  const nextToken = rotated.body.credential.token;
  assert.equal((await call('/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' })).status, 401);
  const nextHeaders = { authorization: `Bearer ${nextToken}`, 'content-type': 'application/json' };
  assert.equal((await call('/v1/agents/heartbeat', { method: 'POST', headers: nextHeaders, body: '{}' })).status, 200);

  const revoked = await call(`/v2/ops/credentials/${rotated.body.credential.id}/revoke`, {
    method: 'POST', headers: opsHeaders, body: '{}',
  });
  assert.equal(revoked.status, 200);
  assert.equal((await call('/v1/agents/heartbeat', { method: 'POST', headers: nextHeaders, body: '{}' })).status, 401);
  assert.equal((await call('/v1/agents/tasks', { method: 'POST', headers: nextHeaders, body: '{}' })).status, 401);
  assert.equal((await call('/v1/agents/tasks/result', {
    method: 'POST', headers: nextHeaders,
    body: JSON.stringify({ taskId: 'revoked-task', leaseToken: 'revoked', resultId: 'revoked-result', status: 'completed' }),
  })).status, 401);

  const reject = await call('/v2/enrollments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'reject-once', siteId: 'site-a', agentId: 'rejected-runner' }),
  });
  assert.equal((await call(`/v2/ops/enrollments/${reject.body.enrollmentId}/reject`, {
    method: 'POST', headers: opsHeaders, body: '{}',
  })).status, 200);

  console.log('ENROLLMENT_UNIT_OK');
} finally {
  await new Promise((resolve) => boot.server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
