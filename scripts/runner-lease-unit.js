import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, db, openDb } from '../src/relay/db.js';
import {
  acknowledgeRunnerTask,
  pollRunnerTasks,
  renewRunnerTask,
  submitRunnerTaskResult,
} from '../src/relay/runners.js';
import { requeueTask } from '../src/relay/services/taskQueueService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-runner-lease-'));
const config = { runnerTaskLeaseSec: 30, runnerTaskMaxAttempts: 3, runners: [] };
const runner = { id: 'runner-lease', channel_id: 'channel-lease' };

function insertTask(id, { maxAttempts = 3, createdOffset = 0 } = {}) {
  db()
    .prepare(
      `INSERT INTO runner_tasks
       (id, runner_id, channel_id, env, group_id, agent_name, prompt, status, max_attempts, available_at, created_at)
       VALUES (?, ?, ?, 'canary', 'group-lease', 'Agent', ?, 'queued', ?, datetime('now'), datetime('now', ?))`
    )
    .run(id, runner.id, runner.channel_id, id, maxAttempts, `${createdOffset} seconds`);
}

try {
  openDb(path.join(root, 'connector.db'));
  db()
    .prepare(
      `INSERT INTO runners (id, agent_type, role, channel_id, token_hash, status, runtime, last_seen_at)
       VALUES (?, 'runner', 'general', ?, 'runner-lease-token-hash', 'active', 'local', datetime('now'))`
    )
    .run(runner.id, runner.channel_id);

  insertTask('task-atomic');
  const [first, second] = await Promise.all([
    pollRunnerTasks(config, runner, { limit: 1 }),
    pollRunnerTasks(config, runner, { limit: 1 }),
  ]);
  const claimed = [...first.body.tasks, ...second.body.tasks];
  assert.equal(claimed.length, 1, 'concurrent poll claims task once');
  const original = claimed[0];
  assert(original.leaseToken && original.attempt === 1);

  const blocked = await pollRunnerTasks(config, runner, { limit: 1 });
  assert.equal(blocked.body.tasks.length, 0, 'fresh lease blocks another claim');

  db().prepare(`UPDATE runner_tasks SET lease_until = datetime('now', '-1 second') WHERE id = ?`).run('task-atomic');
  const reclaimed = await pollRunnerTasks(config, runner, { limit: 1 });
  assert.equal(reclaimed.body.tasks.length, 1);
  assert.equal(reclaimed.body.tasks[0].attempt, 2);
  assert.notEqual(reclaimed.body.tasks[0].leaseToken, original.leaseToken);
  const active = reclaimed.body.tasks[0];

  const stale = await submitRunnerTaskResult(config, runner, {
    taskId: 'task-atomic',
    leaseToken: original.leaseToken,
    resultId: 'result-stale',
    status: 'completed',
    content: 'stale',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_LEASE');

  const ack = await acknowledgeRunnerTask(config, runner, {
    taskId: 'task-atomic',
    leaseToken: active.leaseToken,
  });
  assert.equal(ack.status, 200);
  const renew = await renewRunnerTask(config, runner, {
    taskId: 'task-atomic',
    leaseToken: active.leaseToken,
  });
  assert.equal(renew.status, 200);

  const completedBody = {
    taskId: 'task-atomic',
    leaseToken: active.leaseToken,
    resultId: 'result-final',
    status: 'completed',
    content: 'done',
  };
  const completed = await submitRunnerTaskResult(config, runner, completedBody);
  assert.equal(completed.status, 200);
  const duplicate = await submitRunnerTaskResult(config, runner, completedBody);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  const conflict = await submitRunnerTaskResult(config, runner, { ...completedBody, content: 'different' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'RESULT_ID_CONFLICT');

  insertTask('task-dead', { maxAttempts: 1, createdOffset: -2 });
  insertTask('task-after-dead', { maxAttempts: 3, createdOffset: -1 });
  const deadLease = await pollRunnerTasks(config, runner, { limit: 1 });
  assert.equal(deadLease.body.tasks[0].taskId, 'task-dead');
  db().prepare(`UPDATE runner_tasks SET lease_until = datetime('now', '-1 second') WHERE id = 'task-dead'`).run();
  const afterDead = await pollRunnerTasks(config, runner, { limit: 1 });
  assert.equal(db().prepare(`SELECT status FROM runner_tasks WHERE id = 'task-dead'`).get().status, 'dead');
  assert.equal(afterDead.body.tasks[0].taskId, 'task-after-dead');

  const finishAfterDead = await submitRunnerTaskResult(config, runner, {
    taskId: 'task-after-dead', leaseToken: afterDead.body.tasks[0].leaseToken,
    resultId: 'result-after-dead', status: 'completed', content: 'clear queue',
  });
  assert.equal(finishAfterDead.status, 200);
  insertTask('task-requeue');
  const oldGeneration = (await pollRunnerTasks(config, runner, { limit: 1 })).body.tasks[0];
  db().prepare(`UPDATE runner_tasks SET status='dead' WHERE id='task-requeue'`).run();
  assert.equal((await requeueTask('task-requeue', { actor: 'test', reason: 'new generation' })).status, 200);
  const newGeneration = (await pollRunnerTasks(config, runner, { limit: 1 })).body.tasks[0];
  assert.notEqual(newGeneration.leaseToken, oldGeneration.leaseToken);
  const lateOldGeneration = await submitRunnerTaskResult(config, runner, {
    taskId: 'task-requeue', leaseToken: oldGeneration.leaseToken,
    resultId: 'result-old-generation', status: 'completed', content: 'must not win',
  });
  assert.equal(lateOldGeneration.status, 409);
  assert.equal(lateOldGeneration.body.code, 'STALE_LEASE');

  console.log('RUNNER_LEASE_UNIT_OK');
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
