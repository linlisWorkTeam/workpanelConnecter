import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import { createRunnerClient } from '../src/runners/runnerClient.js';
import { runRunner, executeLeasedTask } from '../src/runners/runnerLoop.js';
import { startTaskLease } from '../src/runners/taskLease.js';
import { createWorkpanelExecutor } from '../src/runners/workpanelExecutor.js';

const task = { taskId: 'task-a', leaseToken: 'lease-a', attempt: 2, leaseSec: 0.3 };

test('long execution keeps heartbeat and lease alive, including result submission', async () => {
  let heartbeats = 0;
  let renewals = 0;
  let results = 0;
  const client = {
    register: async () => ({ channelId: 'c' }),
    heartbeat: async () => { heartbeats++; return { status: 200 }; },
    poll: async () => ({ status: 200, body: { tasks: [task] } }),
    ack: async () => ({ status: 200 }),
    renew: async () => { renewals++; return { status: 200, body: { leaseSec: 0.3 } }; },
    result: async (_, value) => {
      const before = renewals;
      await sleep(350);
      assert.ok(renewals > before, 'renewal continues during result HTTP request');
      assert.equal(value.resultId, 'result_task-a_2_final');
      results++;
      return { status: 200 };
    },
  };
  const sigintCount = process.listenerCount('SIGINT');
  await runRunner({
    client, name: 'test-runner', registration: { agentId: 'a' }, once: true, heartbeatMs: 1000,
    execute: async (_, { signal }) => {
      await sleep(1200, undefined, { signal });
      return { status: 'completed', content: 'done', writeBack: false };
    },
  });
  assert.ok(heartbeats >= 2);
  assert.ok(renewals >= 3);
  assert.equal(results, 1);
  assert.equal(process.listenerCount('SIGINT'), sigintCount, 'signal handlers cleaned up');
});

test('stale lease aborts executor and suppresses all late results', async () => {
  let results = 0;
  await executeLeasedTask({
    ack: async () => ({ status: 200 }),
    renew: async () => ({ status: 409 }),
    result: async () => { results++; return { status: 200 }; },
  }, task, async (_, { signal, reportRunning }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    await assert.rejects(reportRunning('late'), /lease lost/);
    return { status: 'completed', content: 'late' };
  });
  assert.equal(results, 0);
});

test('transient renewal failure recovers before expiry', async () => {
  let renewals = 0;
  const lease = startTaskLease({ renew: async () => {
    renewals++;
    if (renewals === 1) throw new Error('network');
    return { status: 200, body: { leaseSec: 0.3 } };
  } }, task);
  try {
    await sleep(420);
    assert.ok(renewals >= 2);
    assert.equal(lease.isActive(), true);
  } finally { lease.stop(); }
});

test('late successful renewal cannot revive an expired lease', async () => {
  let renewals = 0;
  const lease = startTaskLease({ renew: async () => {
    renewals++;
    await sleep(350);
    return { status: 200, body: { leaseSec: 60 } };
  } }, task);
  try {
    await sleep(550);
    assert.equal(renewals, 1);
    assert.equal(lease.signal.aborted, true);
    assert.equal(lease.isActive(), false);
  } finally { lease.stop(); }
});

test('ack consuming the remaining lease prevents execution', async () => {
  let executed = false;
  await executeLeasedTask({
    ack: async () => { await sleep(350); return { status: 200 }; },
    renew: async () => ({ status: 503 }),
  }, task, async () => { executed = true; });
  assert.equal(executed, false);
});

test('executor failure clears renewal timers', async () => {
  let renewals = 0;
  await assert.rejects(executeLeasedTask({
    ack: async () => ({ status: 200 }),
    renew: async () => { renewals++; return { status: 200 }; },
  }, task, async () => { throw new Error('executor failed'); }), /executor failed/);
  await sleep(350);
  assert.equal(renewals, 0);
});

test('shared HTTP client authenticates, claims one task, and times out', async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    if (req.url.endsWith('/heartbeat')) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tasks: [] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createRunnerClient({
      relayUrl: `http://127.0.0.1:${server.address().port}/`, token: 'test-token', requestTimeoutMs: 100,
    });
    await client.register({ agentId: 'a' });
    await client.poll();
    await client.result(task, { taskId: 'wrong', leaseToken: 'wrong', status: 'completed' });
    await assert.rejects(client.heartbeat(), { name: 'TimeoutError' });
    assert.equal(seen[0].auth, undefined);
    assert.equal(seen[0].body.token, 'test-token');
    assert.equal(seen[1].path, '/v1/agents/tasks?limit=1');
    assert.equal(seen[1].auth, 'Bearer test-token');
    assert.equal(seen[2].body.leaseToken, task.leaseToken);
    assert.equal(seen[2].body.taskId, task.taskId);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('WorkPanel executor preserves production guard and honors prior lease cancellation', async () => {
  const execute = createWorkpanelExecutor({ backends: { canary: { baseUrl: 'http://localhost:8080' } } });
  const result = await execute({ ...task, env: 'canary' }, { signal: new AbortController().signal });
  assert.equal(result.status, 'failed');
  assert.equal(result.writeBack, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createWorkpanelExecutor({ backends: { canary: { baseUrl: 'http://localhost:8081' } } })(
    { ...task, env: 'canary' }, { signal: controller.signal },
  ), { name: 'AbortError' });
});
