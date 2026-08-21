import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createFederationEnvelope } from '../src/relay/contracts/federation.js';
import { groupRef, stableSubjectId } from '../src/relay/services/identityService.js';
import { db, closeDb } from '../src/relay/db.js';
import { listenRelay } from '../src/relay/server.js';
import { stopHostJoin } from '../src/relay/hostJoin.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-inbox-retry-'));
const hostPort = 19300;
const sitePort = 19302;
const ref = groupRef({ authority: 'site-a', groupId: 'retry-group' });
const envelope = createFederationEnvelope({
  originSite: 'site-a', targetSite: 'site-b', groupRef: ref,
  fromSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'pet-a' }),
  toSubject: stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'runner-b' }),
  kind: 'chat.command', payload: {
    originalMessageId: 'msg-inbox-retry', env: 'canary', groupName: 'Retry Group',
    agentName: 'DeepSeek', content: 'retry without Host redelivery', context: { source: 'test' },
  },
});
let offered = false;
let offeredMessages = 0;
let completion = null;
let ackRequests = 0;

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) });
  res.end(raw);
}

const fakeHost = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${hostPort}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  if (url.pathname === '/v1/host/peers/register') return send(res, 200, { ok: true, siteId: 'site-b' });
  if (url.pathname === '/v1/host/peers/heartbeat') return send(res, 200, { ok: true });
  if (url.pathname === '/v1/federation/directory/advertise') return send(res, 200, { ok: true });
  if (url.pathname === '/v1/federation/directory') return send(res, 200, { routes: [] });
  if (url.pathname === '/v1/federation/pull') {
    if (offered) return send(res, 200, { messages: [] });
    offered = true;
    offeredMessages += 1;
    return send(res, 200, { messages: [{ envelope, leaseToken: 'host-lease-one', leaseSec: 60, attempt: 1 }] });
  }
  if (url.pathname === '/v1/federation/ack') {
    ackRequests += 1;
    if (ackRequests === 1) { req.socket.destroy(); return; }
    return send(res, 200, { ok: true, status: 'acknowledged' });
  }
  if (url.pathname === '/v1/federation/result') {
    completion = body.status;
    return send(res, 200, { ok: true, status: body.status });
  }
  if (url.pathname === '/v1/federation/messages') return send(res, 202, { accepted: true, status: 'queued' });
  return send(res, 404, { error: 'not found' });
});

function eventually(fn, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const result = await fn();
        if (result) return resolve(result);
      } catch {}
      if (Date.now() >= deadline) return reject(new Error(`${label} timeout`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function call(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${sitePort}${pathname}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const configPath = path.join(root, 'site-b.json');
const dbPath = path.join(root, 'site-b.db');
fs.writeFileSync(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port: sitePort }, db: { path: dbPath }, auth: { tokens: ['ops-b'] },
  host: { role: 'connecter', siteId: 'site-b', baseUrl: `http://127.0.0.1:${hostPort}`, token: 'token-b', heartbeatMs: 150 },
  directoryV2RoutingEnabled: true, runnerHeartbeatTtlSec: 30,
  federation: { inboxMaxAttempts: 5, policies: [
    { originSite: 'site-a', targetSite: 'site-b', groupRef: ref, subjectId: '*', operation: '*', direction: '*', effect: 'allow' },
  ] },
  backends: {}, pets: [], runners: [{
    agentId: 'runner-b', displayName: 'DeepSeek', token: 'runner-token-b', protocolVersion: 2,
    capabilities: ['chat'], bindings: [{ env: 'canary', groupId: 'retry-group', groupRef: ref, groupName: 'Retry Group', agentName: 'DeepSeek' }],
  }],
}, null, 2));

await new Promise((resolve) => fakeHost.listen(hostPort, '127.0.0.1', resolve));
const relay = await listenRelay({ configPath, dbPath, resume: false });
try {
  const retryRow = await eventually(() => {
    const row = db().prepare(`SELECT * FROM federation_inbox WHERE message_id=?`).get(envelope.messageId);
    return row?.status === 'retry' && row;
  }, 'inbox enters local retry');
  assert.equal(retryRow.attempt, 1);
  assert.match(retryRow.last_error, /target unavailable/);

  const runnerHeaders = { authorization: 'Bearer runner-token-b', 'content-type': 'application/json' };
  assert.equal((await call('/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'runner-b', token: 'runner-token-b', protocolVersion: 2 }) })).status, 200);
  assert.equal((await call('/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' })).status, 200);
  const task = await eventually(async () => {
    const response = await call('/v1/agents/tasks', { method: 'POST', headers: runnerHeaders, body: '{}' });
    return response.body.tasks?.[0];
  }, 'retry creates runner task');
  assert.equal(task.prompt, 'retry without Host redelivery');
  await eventually(() => completion === 'delivered', 'Host completion after local retry');
  assert.equal(offeredMessages, 1, 'body was not redelivered by Host');
  assert.ok(ackRequests >= 2, 'lost ack response was reconciled from the local inbox lease token');
  assert.equal(db().prepare(`SELECT COUNT(*) n FROM runner_tasks WHERE federation_message_id=?`).get(envelope.messageId).n, 1);
  console.log('FEDERATION_INBOX_RETRY_E2E_OK');
} finally {
  stopHostJoin();
  await new Promise((resolve) => relay.server.close(resolve));
  await new Promise((resolve) => fakeHost.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
