#!/usr/bin/env node
/**
 * E1 gate: DeepSeek Harness (dsh) runner registry + outbound task loop.
 *
 * Covers (bridge-deepseek-harness.md §4.4 / B7):
 * - POST /v1/agents/register  (provisioned token only; wrong -> 401, unknown -> 403)
 * - GET  /v1/agents           (ops only; lists runner bindings)
 * - POST /v1/agents/heartbeat (runner bearer)
 * - pet chat bound to a dsh general binding -> enqueues runner task (no WP dispatch)
 * - POST /v1/agents/tasks     (runner pulls queued task, marks dispatched)
 * - POST /v1/agents/tasks/result (completed -> down echo to pet poll)
 * - special runner: at most ONE (second special binding -> 409)
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
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

function startMockWp(port, groupId) {
  const group = {
    id: groupId,
    name: '灰度测试',
    adminMemberId: 'ag-deepseek',
    ownerMemberId: 'user-1',
  };
  const members = [
    { id: 'user-1', kind: 'user', displayName: 'root', isActive: true, authUserId: 'u-root' },
    { id: 'ag-deepseek', kind: 'agent', displayName: 'DeepSeek', isActive: true },
  ];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === '/api/health') return send(200, { ok: true });
      if (u.pathname === '/api/auth/login' && req.method === 'POST') {
        return send(200, { token: 'mock-wp', user_id: 'u-root', username: 'root', isAdmin: true });
      }
      if (u.pathname === '/api/presence' && req.method === 'GET') {
        return send(200, { onlineUserIds: ['u-root'] });
      }
      if (u.pathname === '/api/presence/heartbeat' && req.method === 'POST') {
        return send(200, { ok: true, ttlMs: 90000, onlineUserIds: ['u-root'] });
      }
      if (u.pathname === '/api/groups' && req.method === 'GET') return send(200, [group]);
      if (u.pathname === `/api/groups/${groupId}` && req.method === 'GET') {
        return send(200, { group, members });
      }
      if (u.pathname === '/api/messages' && req.method === 'POST') {
        return send(200, { message: { id: 'wp-msg-1' }, runIds: ['wp-run-1'] });
      }
      send(404, { error: 'nope' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-runner-'));
  const dbPath = path.join(tmp, 'connector.db');
  const cfgPath = path.join(tmp, 'relay.json');
  const PORT = Number(process.env.CONNECTER_RELAY_PORT || 9096);
  const OPS_TOKEN = 'gate-ops-token';
  const PET_TOKEN = 'runner-pet-token';
  const RUNNER_TOKEN = 'dsh-gate-token';
  const SPECIAL_TOKEN = 'dsh-special-token';
  const GROUP_ID = 'grp-runner-test';
  const mockWp = await startMockWp(19998, GROUP_ID);

  const config = {
    listen: { host: '127.0.0.1', port: PORT },
    db: { path: dbPath },
    auth: { tokens: [OPS_TOKEN] },
    allowProdFromPet: false,
    runnerHeartbeatTtlSec: 60,
    rateLimitPerMin: 120,
    backends: {
      // canary is configured but must NOT be touched: the chat below is dsh-bound
      canary: { baseUrl: 'http://127.0.0.1:19998', kind: 'workpanel' },
    },
    defaults: { env: 'canary', group: '灰度测试', coordinatorAgentName: 'DeepSeek' },
    pets: [
      {
        id: 'pet-runner',
        name: 'Runner Pet',
        token: PET_TOKEN,
        groups: [
          { env: 'canary', groupId: GROUP_ID, groupName: '灰度测试', agentName: 'DeepSeek' },
        ],
      },
    ],
    runners: [
      {
        agentId: 'dsh-gate-1',
        token: RUNNER_TOKEN,
        role: 'general',
        runtime: 'local',
        bindings: [
          { env: 'canary', groupId: GROUP_ID, groupName: '灰度测试', agentName: 'DeepSeek' },
        ],
      },
      {
        agentId: 'dsh-special-1',
        token: SPECIAL_TOKEN,
        role: 'special',
        runtime: 'remote',
        bindings: [
          { env: 'canary', groupId: 'wp-maintenance', groupName: 'WorkPanel 群', agentName: 'DeepSeek' },
        ],
      },
    ],
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

  process.env.CONNECTER_RELAY_PORT = String(PORT);
  process.env.CONNECTER_RELAY_HOST = '127.0.0.1';

  const { server } = await listenRelay({ configPath: cfgPath, dbPath, resume: false });
  const base = `http://127.0.0.1:${PORT}`;
  const runnerHeaders = {
    authorization: `Bearer ${RUNNER_TOKEN}`,
    'content-type': 'application/json',
  };
  const petHeaders = {
    authorization: `Bearer ${PET_TOKEN}`,
    'content-type': 'application/json',
  };

  try {
    assert((await jsonFetch(`${base}/v1/health`)).body.ok === true, 'health');

    // ---- register: auth/validation ----
    const wrongToken = await jsonFetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'dsh-gate-1', token: 'bad', groups: [] }),
    });
    assert(wrongToken.status === 401, 'register wrong token -> 401');

    const unknown = await jsonFetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'dsh-nope', token: RUNNER_TOKEN, groups: [] }),
    });
    assert(unknown.status === 403, 'register unknown agentId -> 403');

    const reg = await jsonFetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'dsh-gate-1', token: RUNNER_TOKEN, groups: [] }),
    });
    assert(reg.status === 200, 'register ok');
    assert(reg.body.channelId && reg.body.taskUrl.endsWith('/v1/agents/tasks'), 'channelId + taskUrl');

    // ---- ops list ----
    const badList = await jsonFetch(`${base}/v1/agents`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(badList.status === 403, 'agent list requires ops');
    const list = await jsonFetch(`${base}/v1/agents?group=${GROUP_ID}`, {
      headers: { authorization: `Bearer ${OPS_TOKEN}` },
    });
    assert(list.status === 200, 'agent list ok');
    assert(list.body.agents.some((b) => b.agent_name === 'DeepSeek' && b.group_id === GROUP_ID), 'list has general binding');

    // ---- heartbeat ----
    const hb = await jsonFetch(`${base}/v1/agents/heartbeat`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({}),
    });
    assert(hb.status === 200 && hb.body.ok === true, 'heartbeat');

    // ---- pet chat bound to dsh general runner -> enqueue, no WP dispatch ----
    const msgId = `msg_runner_gate_${randomUUID()}`;
    const chat = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({ id: msgId, group: '灰度测试', prompt: 'runner ping' }),
    });
    assert(chat.status === 200 && chat.body.status === 'accepted', 'chat accepted');
    assert(chat.body.runner && chat.body.runner.channelId, 'chat routed to runner channel');
    assert(chat.body.runIds.length === 1 && chat.body.runIds[0] === msgId, 'runner task id = up msg id');

    // no runner yet -> task queued -> pull it
    const empty = await jsonFetch(`${base}/v1/agents/tasks`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({}),
    });
    assert(Array.isArray(empty.body.tasks), 'tasks is array');
    const pulled = empty.body.tasks.find((t) => t.taskId === msgId);
    assert(!!pulled && pulled.prompt === 'runner ping', 'task pulled with prompt');

    // serial: second chat stays queued while first is dispatched
    const msgId2 = `msg_runner_gate2_${randomUUID()}`;
    const chat2 = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({ id: msgId2, group: '灰度测试', prompt: 'runner ping 2' }),
    });
    assert(chat2.status === 200, 'second chat accepted');
    const blocked = await jsonFetch(`${base}/v1/agents/tasks`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({}),
    });
    assert(blocked.body.tasks.length === 0, 'serial: no second dispatch while in-flight');

    // two-phase: running down then completed
    const running = await jsonFetch(`${base}/v1/agents/tasks/result`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({
        taskId: msgId,
        status: 'running',
        content: 'wp_accepted messageId=wp-fake',
        writeBack: false,
      }),
    });
    assert(running.status === 200 && running.body.status === 'running', 'running phase');

    const pollRun = await jsonFetch(`${base}/v1/messages?since=0&group=${encodeURIComponent('灰度测试')}`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(
      pollRun.body.messages.some((m) => String(m.envelope?.payload?.content || '').includes('wp_accepted')),
      'pet sees first-phase wp_accepted'
    );

    // ---- submit result -> down echo visible to pet ----
    const res = await jsonFetch(`${base}/v1/agents/tasks/result`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({ taskId: msgId, status: 'completed', content: 'hello back', writeBack: false }),
    });
    assert(res.status === 200 && res.body.ok === true, 'result ok');

    const poll = await jsonFetch(`${base}/v1/messages?since=0&group=${encodeURIComponent('灰度测试')}`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(poll.status === 200, 'poll ok');
    const seesBack = poll.body.messages.some(
      (m) => m.direction === 'down' && String(m.envelope?.payload?.content || '').includes('hello back')
    );
    assert(seesBack, 'pet poll sees runner down echo');

    const pulled2 = await jsonFetch(`${base}/v1/agents/tasks`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({}),
    });
    assert(pulled2.body.tasks.some((t) => t.taskId === msgId2), 'second task dispatched after first completed');
    await jsonFetch(`${base}/v1/agents/tasks/result`, {
      method: 'POST',
      headers: runnerHeaders,
      body: JSON.stringify({ taskId: msgId2, status: 'completed', content: 'ok2', writeBack: false }),
    });

    // TTL: force stale last_seen
    const { db } = await import('../src/relay/db.js');
    db()
      .prepare(`UPDATE runners SET last_seen_at = datetime('now', '-120 seconds') WHERE id = ?`)
      .run('dsh-gate-1');
    const stale = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({ id: `msg_stale_${randomUUID()}`, group: '灰度测试', prompt: 'should 503' }),
    });
    assert(stale.status === 503 && stale.body.error === 'runner_offline', 'stale runner -> 503');

    // ---- special: at most one ----
    const specialConflict = await jsonFetch(`${base}/v1/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'dsh-special-1',
        token: SPECIAL_TOKEN,
        groups: [{ env: 'canary', groupId: 'another-special-group', groupName: 'bogus', agentName: 'DeepSeek' }],
      }),
    });
    assert(specialConflict.status === 409, 'second special binding -> 409');

    console.log('\nRUNNER_GATE_OK');
    console.log(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          phase: 'E1',
          agentId: 'dsh-gate-1',
          messageId: msgId,
          channelId: reg.body.channelId,
          note: 'runners register/heartbeat/tasks/result + pet-chat dsh routing + special uniqueness',
        },
        null,
        2
      )
    );
  } finally {
    server.close();
    mockWp.close();
    closeDb();
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
