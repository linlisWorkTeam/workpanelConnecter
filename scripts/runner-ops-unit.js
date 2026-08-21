import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/relay/db.js';
import { listenRelay, closeDb } from '../src/relay/server.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-runner-ops-'));
const port = 9112;
const token = 'ops-task-token';
const configPath = path.join(root, 'relay.json');
const dbPath = path.join(root, 'connector.db');
fs.writeFileSync(
  configPath,
  JSON.stringify({
    listen: { host: '127.0.0.1', port },
    db: { path: dbPath },
    auth: { tokens: [token] },
    runners: [{ agentId: 'runner-ops', token: 'runner-ops-token', bindings: [] }],
    pets: [],
    backends: {},
  })
);

function request(pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, options).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
}

const boot = await listenRelay({ configPath, dbPath, resume: false });
try {
  db()
    .prepare(
      `INSERT INTO runner_tasks
       (id, runner_id, channel_id, env, group_id, agent_name, prompt, status, max_attempts)
       VALUES ('task-ops', 'runner-ops', 'ch-ops', 'canary', 'group-ops', 'Agent', 'ops', 'dead', 3)`
    )
    .run();

  const forbidden = await request('/v1/ops/tasks');
  assert.equal(forbidden.status, 401);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const listed = await request('/v1/ops/tasks?status=dead', { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.tasks[0].id, 'task-ops');

  const requeued = await request('/v1/ops/tasks/task-ops/requeue', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'operator retry' }),
  });
  assert.equal(requeued.status, 200);
  assert.equal(requeued.body.status, 'queued');

  const cancelled = await request('/v1/ops/tasks/task-ops/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'operator cancel' }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');

  const final = await request('/v1/ops/tasks?runnerId=runner-ops', { headers });
  assert.equal(final.body.tasks[0].status, 'cancelled');
  assert.deepEqual(final.body.tasks[0].audit.map((row) => row.action), ['requeued', 'cancelled']);
  console.log('RUNNER_OPS_UNIT_OK');
} finally {
  await new Promise((resolve) => boot.server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
