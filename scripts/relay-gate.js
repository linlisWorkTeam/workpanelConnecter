#!/usr/bin/env node
/**
 * Phase 1.5 relay gate: SQLite + config pets + poll echo + idempotency + dead letter.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/config.js';
import { listenRelay, closeDb } from '../src/relay/server.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function waitUrl(url, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mock WP exited early: ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-relay15-'));
  const dbPath = path.join(tmp, 'connector.db');
  const cfgPath = path.join(tmp, 'relay.json');
  // 专用测试端口：9080 已被生产 systemd 服务占用，门禁自起实例用 9095
  const PORT = Number(process.env.CONNECTER_RELAY_PORT || 9095);
  const WP_PORT = 18082;
  const DEAD_WP_PORT = 18083;
  const PET_TOKEN = 'gate-pet-token';
  const OPS_TOKEN = 'gate-ops-token';

  const config = {
    listen: { host: '127.0.0.1', port: PORT },
    db: { path: dbPath },
    auth: { tokens: [OPS_TOKEN] },
    allowProdFromPet: false,
    rateLimitPerMin: 120,
    backends: {
      canary: {
        baseUrl: `http://127.0.0.1:${WP_PORT}`,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
      prod: {
        baseUrl: 'http://127.0.0.1:8080',
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
      dead: {
        baseUrl: `http://127.0.0.1:${DEAD_WP_PORT}`,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
    defaults: {
      env: 'canary',
      group: '灰度测试',
      coordinatorAgentName: 'Cursor Agent',
    },
    pets: [
      {
        id: 'pet-gate',
        name: 'Gate Pet',
        token: PET_TOKEN,
        groups: [
          {
            env: 'canary',
            groupId: '528b36ba-4769-4b4d-9fa8-51e2de132396',
            groupName: '灰度测试',
            agentName: 'Cursor Agent',
          },
          {
            env: 'canary',
            groupId: 'group-b-dummy',
            groupName: 'dummy-b',
            agentName: 'Cursor Agent',
          },
        ],
      },
      {
        id: 'pet-dead',
        name: 'Dead Pet',
        token: 'dead-pet-token',
        groups: [
          {
            env: 'dead',
            groupId: 'anywhere',
            groupName: 'anywhere',
            agentName: 'Cursor Agent',
          },
        ],
      },
    ],
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

  process.env.CONNECTER_RELAY_PORT = String(PORT);
  process.env.CONNECTER_RELAY_HOST = '127.0.0.1';

  const mockWp = spawn(process.execPath, ['mock/workpanel-server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(WP_PORT),
      GATE_GROUP_ID: '528b36ba-4769-4b4d-9fa8-51e2de132396',
      GATE_GROUP_NAME: '灰度测试',
      COORDINATOR_NAME: 'Cursor Agent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadMockWp = spawn(process.execPath, ['mock/workpanel-server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(DEAD_WP_PORT),
      GROUP_ID: 'anywhere',
      GROUP_NAME: 'anywhere',
      COORDINATOR_NAME: 'Cursor Agent',
      FAIL_MESSAGES: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitUrl(`http://127.0.0.1:${WP_PORT}/api/health`, mockWp);
  await waitUrl(`http://127.0.0.1:${DEAD_WP_PORT}/api/health`, deadMockWp);

  const { server } = await listenRelay({
    configPath: cfgPath,
    dbPath,
    resume: false,
  });

  const base = `http://127.0.0.1:${PORT}`;
  const petHeaders = {
    authorization: `Bearer ${PET_TOKEN}`,
    'content-type': 'application/json',
  };

  try {
    assert((await jsonFetch(`${base}/v1/health`)).body.ok === true, 'health');

    assert((await jsonFetch(`${base}/v1/envs`)).status === 401, 'envs needs auth');

    const inst = await jsonFetch(`${base}/v1/instances`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(inst.status === 200, 'instances');
    assert(inst.body.instances.length === 2, '2 agent_instances for 2 groups');

    // prod forbidden
    const prod = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({ env: 'prod', group: '灰度测试', prompt: 'no' }),
    });
    assert(prod.status === 403, 'prod forbidden');

    // canary chat
    const msgId = `msg_gate_${randomUUID()}`;
    const chat = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({
        id: msgId,
        group: '灰度测试',
        prompt: `Phase1.5 relay-gate ${new Date().toISOString()} — 请仅确认收到，勿深层委派。`,
      }),
    });
    if (chat.status !== 200 || chat.body.status !== 'accepted') {
      console.error(chat);
      throw new Error('canary chat failed: ' + (chat.body?.error || ''));
    }
    assert(chat.body.messageId === msgId, 'messageId echo');
    assert(Array.isArray(chat.body.runIds), 'runIds');

    // poll echo
    const poll = await jsonFetch(`${base}/v1/messages?since=0&group=${encodeURIComponent('灰度测试')}`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(poll.status === 200, 'poll');
    assert(poll.body.messages.some((m) => m.id === msgId), 'poll sees up message');
    assert(
      poll.body.messages.some((m) => m.direction === 'down'),
      'poll sees down ack'
    );

    // idempotent
    const again = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({
        id: msgId,
        group: '灰度测试',
        prompt: 'duplicate should not double-send',
      }),
    });
    assert(again.status === 200 && again.body.idempotent === true, 'idempotent');

    // dead letter path
    const dead = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer dead-pet-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: `msg_dead_${randomUUID()}`,
        env: 'dead',
        group: 'anywhere',
        prompt: 'should fail',
      }),
    });
    assert(
      dead.status === 502 || dead.body.status === 'failed',
      `dead letter failed: HTTP ${dead.status} ${JSON.stringify(dead.body)}`
    );

    // revoke
    const rev = await jsonFetch(`${base}/v1/session/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(rev.status === 200, 'revoke');
    const after = await jsonFetch(`${base}/v1/instances`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(after.status === 401, 'revoked token 401');

    console.log('\nRELAY_GATE_OK');
    console.log(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          phase: '1.5',
          messageId: msgId,
          runIds: chat.body.runIds,
          instances: inst.body.instances.length,
          note: 'sqlite+config pets+poll+idempotent+deadletter+revoke; local WP mock',
        },
        null,
        2
      )
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await stopChild(mockWp);
    await stopChild(deadMockWp);
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
