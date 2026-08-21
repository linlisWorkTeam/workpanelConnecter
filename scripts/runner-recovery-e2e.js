#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, db, openDb } from '../src/relay/db.js';
import {
  acknowledgeRunnerTask,
  pollRunnerTasks,
  submitRunnerTaskResult,
  syncConfigRunners,
} from '../src/relay/runners.js';
import { reclaimExpiredTasks } from '../src/relay/services/taskQueueService.js';

const childMode = process.argv[2] === '--child' ? process.argv[3] : null;
const childConfigPath = process.argv[4];

async function childMain(mode, configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const dbPath = config.db.path;
  openDb(dbPath);
  await syncConfigRunners(config);
  const runner = db().prepare(`SELECT * FROM runners WHERE id = ?`).get('runner-recovery');
  if (mode === 'claim' || mode === 'claim-running') {
    const taskId = mode === 'claim' ? 'task-recovery' : 'task-recovery-running';
    db()
      .prepare(
        `INSERT OR IGNORE INTO runner_tasks
         (id, runner_id, channel_id, env, group_id, agent_name, prompt, status, max_attempts, available_at)
         VALUES (?, ?, ?, 'canary', 'group-recovery', 'Agent', 'recover me', 'queued', 3, datetime('now'))`
      )
      .run(taskId, runner.id, runner.channel_id);
    const pulled = await pollRunnerTasks(config, runner, { limit: 1 });
    const task = pulled.body.tasks[0];
    if (mode === 'claim-running') {
      const ack = await acknowledgeRunnerTask(config, runner, { taskId: task.taskId, leaseToken: task.leaseToken });
      assert.equal(ack.status, 200);
      const running = await submitRunnerTaskResult(config, runner, {
        taskId: task.taskId, leaseToken: task.leaseToken, resultId: 'result-running', status: 'running', content: 'in progress',
      });
      assert.equal(running.status, 200);
    }
    process.stdout.write(`CHILD_EVENT ${JSON.stringify({ ...task, statusAfter: db().prepare('SELECT status FROM runner_tasks WHERE id=?').get(task.taskId).status })}\n`);
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'recover') {
    const reclaimed = await reclaimExpiredTasks({ actor: 'startup-e2e' });
    const pulled = await pollRunnerTasks(config, runner, { limit: 1 });
    const task = pulled.body.tasks[0];
    const completed = task ? await submitRunnerTaskResult(config, runner, {
      taskId: task.taskId, leaseToken: task.leaseToken, resultId: `result-final-${task.taskId}`,
      status: 'completed', content: 'recovered',
    }) : null;
    process.stdout.write(`CHILD_EVENT ${JSON.stringify({ reclaimed, task, completed: completed?.body })}\n`);
    closeDb();
    return;
  }
  throw new Error(`unknown child mode ${mode}`);
}

function runChild(mode, configPath, { keepAlive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], '--child', mode, configPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let event = null;
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.startsWith('CHILD_EVENT ')) continue;
        event = JSON.parse(line.slice('CHILD_EVENT '.length));
        if (keepAlive) resolve({ child, event });
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && !keepAlive) reject(new Error(`child ${mode} exit ${code}: ${stderr}`));
      else if (!keepAlive && event) resolve({ child, event, stderr });
      else if (!keepAlive) reject(new Error(`child ${mode} exited without event: ${stderr}`));
    });
  });
}

async function parentMain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-runner-recovery-'));
  const configPath = path.join(root, 'relay.json');
  const dbPath = path.join(root, 'connector.db');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      db: { path: dbPath },
      runnerTaskLeaseSec: 1,
      runnerTaskMaxAttempts: 3,
      runners: [{ agentId: 'runner-recovery', token: 'recovery-token', bindings: [] }],
    })
  );
  try {
    const claimed = await runChild('claim', configPath, { keepAlive: true });
    assert.equal(claimed.event.taskId, 'task-recovery');
    assert.equal(claimed.event.attempt, 1);
    claimed.child.kill('SIGKILL');
    await new Promise((resolve) => claimed.child.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const recovered = await runChild('recover', configPath);
    assert(recovered.event.reclaimed.some((row) => row.taskId === 'task-recovery'));
    assert.equal(recovered.event.task.taskId, 'task-recovery');
    assert.equal(recovered.event.task.attempt, 2);
    assert.notEqual(recovered.event.task.leaseToken, claimed.event.leaseToken);
    assert.equal(recovered.event.completed.status, 'completed');

    const runningClaim = await runChild('claim-running', configPath, { keepAlive: true });
    assert.equal(runningClaim.event.taskId, 'task-recovery-running');
    assert.equal(runningClaim.event.statusAfter, 'running');
    runningClaim.child.kill('SIGKILL');
    await new Promise((resolve) => runningClaim.child.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const runningRecovered = await runChild('recover', configPath);
    assert(runningRecovered.event.reclaimed.some((row) => row.taskId === 'task-recovery-running'));
    assert.equal(runningRecovered.event.task.taskId, 'task-recovery-running');
    assert.equal(runningRecovered.event.task.attempt, 2);
    assert.notEqual(runningRecovered.event.task.leaseToken, runningClaim.event.leaseToken);
    assert.equal(runningRecovered.event.completed.status, 'completed');
    console.log('RUNNER_RECOVERY_E2E_OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (childMode) {
  childMain(childMode, childConfigPath).catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
} else {
  parentMain().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
