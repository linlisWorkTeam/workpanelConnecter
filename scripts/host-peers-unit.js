import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listenRelay, closeDb } from '../src/relay/server.js';
import { stopHostJoin } from '../src/relay/hostJoin.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-host-'));
const cfgPath = path.join(tmp, 'relay.json');
const dbPath = path.join(tmp, 'connector.db');
const TOKEN = 'peer-token-windows-dev';
const OPS = 'host-ops';
const PORT = Number(process.env.CONNECTER_HOST_TEST_PORT || 9108);

const config = {
  listen: { host: '127.0.0.1', port: PORT },
  db: { path: dbPath },
  auth: { tokens: [OPS] },
  backends: {
    canary: { baseUrl: 'http://127.0.0.1:8081', kind: 'workpanel' },
  },
  host: {
    role: 'host',
    peers: [{ siteId: 'windows-dev', token: TOKEN, label: '本机' }],
  },
  pets: [],
};
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

const { server } = await listenRelay({ configPath: cfgPath, dbPath, resume: false });
const base = `http://127.0.0.1:${PORT}`;

try {
  const health = await fetch(`${base}/v1/health`).then((r) => r.json());
  assert.equal(health.host.role, 'host');
  assert.equal(health.host.linked, true);

  for (const [method, pathname, body] of [
    ['POST', '/v1/agents/register', { agentId: 'forbidden', token: 'forbidden' }],
    ['POST', '/v1/chat', { prompt: 'forbidden' }],
    ['POST', '/v1/auth/login', { username: 'forbidden', password: 'forbidden' }],
    ['GET', '/v1/groups', undefined],
  ]) {
    const response = await fetch(`${base}${pathname}`, {
      method, headers: { authorization: `Bearer ${OPS}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 404, `${method} ${pathname} must not exist on Connecter Host`);
  }

  const denied = await fetch(`${base}/v1/host/peers/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'windows-dev', token: 'wrong' }),
  });
  assert.equal(denied.status, 401);

  const reg = await fetch(`${base}/v1/host/peers/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: 'windows-dev', token: TOKEN, publicBaseUrl: 'http://127.0.0.1:9080' }),
  });
  const regBody = await reg.json();
  assert.equal(reg.status, 200, JSON.stringify(regBody));
  assert.equal(regBody.ok, true);

  const beat = await fetch(`${base}/v1/host/peers/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(beat.status, 200, await beat.text());

  const listed = await fetch(`${base}/v1/host/peers`, {
    headers: { authorization: `Bearer ${OPS}` },
  }).then((r) => r.json());
  const peer = (listed.peers || []).find((p) => p.siteId === 'windows-dev');
  assert.ok(peer, JSON.stringify(listed));
  assert.equal(peer.linked, true);

  const revoked = await fetch(`${base}/v1/ops/host/peers/windows-dev/revoke`, {
    method: 'POST', headers: { authorization: `Bearer ${OPS}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(revoked.status, 200, await revoked.text());
  const rejectedBeat = await fetch(`${base}/v1/host/peers/heartbeat`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(rejectedBeat.status, 401);
  const rejectedRegister = await fetch(`${base}/v1/host/peers/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: 'windows-dev', token: TOKEN }),
  });
  assert.equal(rejectedRegister.status, 403);

  const NEXT_TOKEN = 'peer-token-rotated-windows-dev';
  const rotated = await fetch(`${base}/v1/ops/host/peers/windows-dev/rotate`, {
    method: 'POST', headers: { authorization: `Bearer ${OPS}`, 'content-type': 'application/json' }, body: JSON.stringify({ token: NEXT_TOKEN }),
  });
  assert.equal(rotated.status, 200, await rotated.text());
  const oldDenied = await fetch(`${base}/v1/host/peers/heartbeat`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(oldDenied.status, 401);
  const oldRegisterDenied = await fetch(`${base}/v1/host/peers/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: 'windows-dev', token: TOKEN }),
  });
  assert.equal(oldRegisterDenied.status, 401);
  const nextRegister = await fetch(`${base}/v1/host/peers/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: 'windows-dev', token: NEXT_TOKEN }),
  });
  assert.equal(nextRegister.status, 200, await nextRegister.text());
  const nextBeat = await fetch(`${base}/v1/host/peers/heartbeat`, {
    method: 'POST', headers: { authorization: `Bearer ${NEXT_TOKEN}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(nextBeat.status, 200, await nextBeat.text());
  console.log('HOST_PEERS_UNIT_OK');
} finally {
  stopHostJoin();
  await new Promise((resolve) => server.close(resolve));
  closeDb();
}
