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
  console.log('HOST_PEERS_UNIT_OK');
} finally {
  stopHostJoin();
  await new Promise((resolve) => server.close(resolve));
  closeDb();
}
