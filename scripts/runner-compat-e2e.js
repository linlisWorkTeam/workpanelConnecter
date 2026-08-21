#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, closeDb } from '../src/relay/db.js';
import { listenRelay } from '../src/relay/server.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-runner-compat-'));
const port = 9116;
const configPath = path.join(root, 'relay.json');
const dbPath = path.join(root, 'connector.db');
fs.writeFileSync(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port }, db: { path: dbPath }, runnerProtocolCompatibility: 'v1',
  auth: { tokens: ['ops-compat'] }, backends: {}, pets: [],
  runners: [
    { agentId: 'runner-v1', token: 'token-v1', bindings: [
      { env: 'canary', groupId: 'group-v1', groupName: 'Group v1', agentName: 'Agent' },
    ] },
    { agentId: 'runner-v2', token: 'token-v2', protocolVersion: 2, bindings: [
      { env: 'canary', groupId: 'group-v2', groupName: 'Group v2', agentName: 'Agent' },
    ] },
  ],
}));

async function call(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

const boot = await listenRelay({ configPath, dbPath, resume: false });
try {
  const register = async (agentId, token, protocolVersion) => call('/v1/agents/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId, token, ...(protocolVersion ? { protocolVersion } : {}), groups: [] }),
  });
  const v1 = await register('runner-v1', 'token-v1');
  const v2 = await register('runner-v2', 'token-v2', 2);
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.equal(v1.body.protocolVersion, 1);
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.protocolVersion, 2);

  const insert = db().prepare(
    `INSERT INTO runner_tasks
     (id,runner_id,channel_id,env,group_id,agent_name,prompt,status,max_attempts,available_at)
     VALUES (?,?,?,?,?,'Agent',?,'queued',3,datetime('now'))`
  );
  insert.run('task-v1', 'runner-v1', v1.body.channelId, 'canary', 'group-v1', 'v1 prompt');
  insert.run('task-v2', 'runner-v2', v2.body.channelId, 'canary', 'group-v2', 'v2 prompt');

  const headersV1 = { authorization: 'Bearer token-v1', 'content-type': 'application/json' };
  const headersV2 = { authorization: 'Bearer token-v2', 'content-type': 'application/json' };
  const pulledV1 = await call('/v1/agents/tasks', { method: 'POST', headers: headersV1, body: '{}' });
  const pulledV2 = await call('/v1/agents/tasks', { method: 'POST', headers: headersV2, body: '{}' });
  assert.equal(pulledV1.body.tasks[0].taskId, 'task-v1');
  assert.equal(pulledV2.body.tasks[0].taskId, 'task-v2');

  assert.equal((await call('/v1/agents/tasks/ack', {
    method: 'POST', headers: headersV1, body: JSON.stringify({ taskId: 'task-v1' }),
  })).status, 200, 'v1 compatibility allows missing lease token');
  assert.equal((await call('/v1/agents/tasks/ack', {
    method: 'POST', headers: headersV2, body: JSON.stringify({ taskId: 'task-v2' }),
  })).status, 428, 'v2 runner never inherits the v1 lease bypass');

  assert.equal((await call('/v1/agents/tasks/result', {
    method: 'POST', headers: headersV1,
    body: JSON.stringify({ taskId: 'task-v1', status: 'completed', content: 'v1 done', writeBack: false }),
  })).status, 200);
  assert.equal((await call('/v1/agents/tasks/result', {
    method: 'POST', headers: headersV2,
    body: JSON.stringify({ taskId: 'task-v2', status: 'completed', content: 'invalid v2', writeBack: false }),
  })).status, 400, 'v2 runner still requires resultId');
  assert.equal((await call('/v1/agents/tasks/result', {
    method: 'POST', headers: headersV2,
    body: JSON.stringify({ taskId: 'task-v2', leaseToken: pulledV2.body.tasks[0].leaseToken,
      resultId: 'result-v2', status: 'completed', content: 'v2 done', writeBack: false }),
  })).status, 200);
  assert.equal(db().prepare(`SELECT status FROM runner_tasks WHERE id='task-v1'`).get().status, 'completed');
  assert.equal(db().prepare(`SELECT status FROM runner_tasks WHERE id='task-v2'`).get().status, 'completed');
  console.log('RUNNER_COMPAT_E2E_OK');
} finally {
  await new Promise((resolve) => boot.server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
