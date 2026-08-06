#!/usr/bin/env node
/**
 * Phase 1.5 relay gate: SQLite + config pets + poll echo + idempotency + dead letter.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
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

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-relay15-'));
  const dbPath = path.join(tmp, 'connector.db');
  const cfgPath = path.join(tmp, 'relay.json');
  // 专用测试端口：9080 已被生产 systemd 服务占用，门禁自起实例用 9095
  const PORT = Number(process.env.CONNECTER_RELAY_PORT || 9095);
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
        baseUrl: 'http://127.0.0.1:8081',
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
      prod: {
        baseUrl: 'http://127.0.0.1:8080',
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
      dead: {
        baseUrl: 'http://127.0.0.1:19999',
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
      throw new Error('canary chat failed — is WP :8081 up? ' + (chat.body?.error || ''));
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
        prompt: 'should fail',
      }),
    });
    assert(dead.status === 502 || dead.body.status === 'failed', 'dead letter failed');

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
          note: 'sqlite+config pets+poll+idempotent+deadletter+revoke; canary live',
        },
        null,
        2
      )
    );
  } finally {
    server.close();
    closeDb();
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
