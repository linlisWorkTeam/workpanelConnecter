import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapRelay, closeDb, createRelayServer } from '../src/relay/server.js';
import { db } from '../src/relay/db.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-workpanel-dispatch-'));
const dbPath = path.join(tempDir, 'relay.db');
const groupId = 'group-provider-test';
const groupRef = `wp:site-test:${encodeURIComponent(groupId)}`;
const serviceToken = 'unit-workpanel-service-token-only';
const readOnlyToken = 'unit-workpanel-read-token-only';
const runnerToken = 'unit-runner-token-only';
const opsToken = 'unit-ops-token-only';
const config = {
  db: { path: dbPath },
  listen: { host: '127.0.0.1', port: 0 },
  auth: { tokens: [opsToken] },
  defaults: { env: 'canary' },
  host: { role: 'standalone', siteId: 'site-test' },
  federation: { enabled: false, requireSignatures: false },
  directoryV2RoutingEnabled: true,
  workpanelServices: [
    {
      id: 'provider-test', token: serviceToken,
      scopes: ['dispatch:create', 'dispatch:read', 'dispatch:cancel'],
      groupRefs: [groupRef], targetSubjectIds: [],
    },
    {
      id: 'provider-read-only', token: readOnlyToken,
      scopes: ['dispatch:read'], groupRefs: [groupRef], targetSubjectIds: [],
    },
  ],
  runners: [
    {
      agentId: 'runner-provider-test', token: runnerToken, role: 'general',
      runtime: 'local', protocolVersion: 2, capabilities: ['codex'],
      bindings: [{ env: 'canary', groupId, groupName: 'Provider Test', agentName: 'Local Codex' }],
    },
  ],
};

let server;
try {
  await bootstrapRelay({ config, dbPath, resume: false });
  ({ server } = createRelayServer({ config }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = async (method, pathname, { token, body, idempotencyKey } = {}) => {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await fetch(`${baseUrl}${pathname}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  // Connecter Host is the stable provider endpoint in multi-site deployments.
  // It must keep the WorkPanel dispatch surface while hiding ordinary site APIs.
  config.host.role = 'host';
  assert.equal((await request('POST', '/v2/dispatches', {
    token: serviceToken, body: {}, idempotencyKey: 'host-route-probe',
  })).status, 400);
  assert.equal((await request('GET', '/v1/envs', { token: opsToken })).status, 404);
  config.host.role = 'standalone';

  assert.equal((await request('POST', '/v1/agents/heartbeat', { token: runnerToken, body: {} })).status, 200);
  const targetSubjectId = db().prepare(
    `SELECT subject_id FROM subjects WHERE site_id='site-test' AND local_id='runner-provider-test'`
  ).get().subject_id;
  config.workpanelServices[0].targetSubjectIds = [targetSubjectId];
  config.workpanelServices[1].targetSubjectIds = [targetSubjectId];

  const dispatchBody = {
    env: 'canary', groupRef, targetSubjectId, prompt: 'Return a structured provider result.',
    requiredCapabilities: ['codex'], writeBack: false,
  };
  assert.equal((await request('POST', '/v2/dispatches', { token: opsToken, body: dispatchBody, idempotencyKey: 'ops-denied' })).status, 403);
  assert.equal((await request('POST', '/v2/dispatches', { token: serviceToken, body: dispatchBody })).status, 400);
  assert.equal((await request('POST', '/v2/dispatches', {
    token: serviceToken, body: { ...dispatchBody, writeBack: true }, idempotencyKey: 'writeback-denied',
  })).status, 400);
  assert.equal((await request('POST', '/v2/dispatches', {
    token: readOnlyToken, body: dispatchBody, idempotencyKey: 'scope-denied',
  })).status, 403);

  const created = await request('POST', '/v2/dispatches', {
    token: serviceToken, body: dispatchBody, idempotencyKey: 'provider-dispatch-1',
  });
  assert.equal(created.status, 202);
  assert.equal(created.body.status, 'queued');
  assert.equal(created.body.writeBack, false);
  assert.equal(created.body.targetSubjectId, targetSubjectId);

  const replay = await request('POST', '/v2/dispatches', {
    token: serviceToken, body: dispatchBody, idempotencyKey: 'provider-dispatch-1',
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.dispatchId, created.body.dispatchId);
  assert.equal(replay.body.idempotent, true);
  assert.equal((await request('POST', '/v2/dispatches', {
    token: serviceToken, body: { ...dispatchBody, prompt: 'different' }, idempotencyKey: 'provider-dispatch-1',
  })).status, 409);

  const polled = await request('POST', '/v1/agents/tasks?limit=1', { token: runnerToken });
  assert.equal(polled.status, 200);
  assert.equal(polled.body.tasks.length, 1);
  const task = polled.body.tasks[0];
  assert.equal(task.taskId, created.body.dispatchId);
  assert.equal(task.context.writeBack, false);
  assert.equal((await request('POST', '/v1/agents/tasks/ack', {
    token: runnerToken, body: { taskId: task.taskId, leaseToken: task.leaseToken },
  })).status, 200);
  const content = { text: 'provider result', threadId: 'thread-test', usage: { input: 3, output: 2 } };
  assert.equal((await request('POST', '/v1/agents/tasks/result', {
    token: runnerToken,
    body: { taskId: task.taskId, leaseToken: task.leaseToken, resultId: 'result-provider-1', status: 'completed', content },
  })).status, 200);

  const completed = await request('GET', `/v2/dispatches/${created.body.dispatchId}`, { token: serviceToken });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'completed');
  assert.deepEqual(completed.body.result.content, content);
  assert.equal(completed.body.result.phase, 'completed');
  assert.equal(completed.body.result.resultId, 'result-provider-1');
  assert.equal((await request('GET', `/v2/dispatches/${created.body.dispatchId}`, { token: readOnlyToken })).status, 404);

  const second = await request('POST', '/v2/dispatches', {
    token: serviceToken, body: { ...dispatchBody, prompt: 'cancel me' }, idempotencyKey: 'provider-dispatch-2',
  });
  assert.equal(second.status, 202);
  const cancelled = await request('POST', `/v2/dispatches/${second.body.dispatchId}/cancel`, {
    token: serviceToken, body: { reason: 'unit test cancellation' },
  });
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.body.status, 'cancelled');
  const cancelReplay = await request('POST', `/v2/dispatches/${second.body.dispatchId}/cancel`, {
    token: serviceToken, body: {},
  });
  assert.equal(cancelReplay.status, 200);
  assert.equal(cancelReplay.body.idempotent, true);

  // A provider running on Connecter Host must queue directly for the remote
  // Site. It has no Host-as-peer token and therefore cannot use the Site
  // outbox/HTTP loopback path.
  const remoteSiteId = 'site-remote';
  const remoteSubjectId = '11111111-1111-5111-8111-111111111111';
  config.host = {
    role: 'host', siteId: 'site-test',
    peers: [{ siteId: remoteSiteId, token: 'unit-remote-peer-token-only' }],
  };
  config.federation = {
    enabled: true,
    requireSignatures: true,
    policies: [{
      originSite: 'site-test', targetSite: remoteSiteId, groupRef,
      subjectId: remoteSubjectId, operation: 'chat.command', direction: 'outbound', effect: 'allow',
    }],
  };
  config.workpanelServices[0].targetSubjectIds = [remoteSubjectId];
  db().prepare(
    `INSERT INTO federation_routes
     (id,group_ref,subject_id,display_name,site_id,capabilities_json,status,expires_at)
     VALUES ('provider-remote-route',?,?,?,?,?,'active',datetime('now','+90 seconds'))`
  ).run(groupRef, remoteSubjectId, 'Remote Codex', remoteSiteId, JSON.stringify(['codex']));
  const remote = await request('POST', '/v2/dispatches', {
    token: serviceToken,
    body: { ...dispatchBody, targetSubjectId: remoteSubjectId, prompt: 'Run on remote Site.' },
    idempotencyKey: 'provider-dispatch-remote-1',
  });
  assert.equal(remote.status, 202);
  assert.equal(remote.body.status, 'federating');
  const remoteMessageId = db().prepare(
    `SELECT federation_message_id FROM workpanel_dispatches WHERE id=?`
  ).get(remote.body.dispatchId).federation_message_id;
  const queuedRemote = db().prepare(
    `SELECT m.origin_site,m.target_site,m.envelope_json,d.status
     FROM federation_messages m JOIN federation_deliveries d ON d.federation_id=m.id
     WHERE m.message_id=?`
  ).get(remoteMessageId);
  assert.equal(queuedRemote.origin_site, 'site-test');
  assert.equal(queuedRemote.target_site, remoteSiteId);
  assert.equal(queuedRemote.status, 'queued');
  assert.equal(JSON.parse(queuedRemote.envelope_json).keyId, 'peer-token-v1');

  console.log('WORKPANEL_DISPATCH_API_OK');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
