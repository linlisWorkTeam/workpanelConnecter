import { startTaskLease } from './taskLease.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executor: async (task, { signal, reportRunning }) => { status, content, writeBack }. */
export async function runRunner({
  client, registration, execute, name, heartbeatMs = 15000, once = false,
}) {
  const registered = await client.register(registration);
  console.log(`[${name}] registered agent=${registration.agentId} channel=${registered.channelId}`);
  let stopping = false;
  let heartbeatPending = false;
  let processed = 0;
  let failures = 0;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  async function heartbeat() {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try {
      const response = await client.heartbeat();
      if (response.status !== 200) console.warn(`[${name}] heartbeat rejected HTTP ${response.status}`);
    } catch {
      console.warn(`[${name}] heartbeat unavailable; will retry`);
    } finally {
      heartbeatPending = false;
    }
  }

  const heartbeatTimer = setInterval(heartbeat, Math.max(1000, heartbeatMs));
  try {
    await heartbeat();
    while (!stopping) {
      let pulled;
      // Conservative lease start includes the time spent receiving the claim response.
      const acquiredAt = Date.now();
      try {
        pulled = await client.poll();
        if (pulled.status !== 200) throw new Error(`HTTP ${pulled.status}`);
        if (!Array.isArray(pulled.body?.tasks) || pulled.body.tasks.length > 1) {
          throw new Error('invalid task poll response');
        }
        failures = 0;
      } catch {
        failures += 1;
        const retryMs = Math.min(30000, 800 * (2 ** Math.min(failures - 1, 5)));
        console.warn(`[${name}] poll unavailable; retrying in ${retryMs}ms`);
        await sleep(retryMs);
        continue;
      }
      for (const task of pulled.body.tasks) {
        try {
          await executeLeasedTask(client, task, execute, acquiredAt);
          processed += 1;
          if (once) stopping = true;
        } catch {
          // Do not print errors from providers: they can contain private output.
          console.warn(`[${name}] task failed locally; lease will recover`);
        }
      }
      if (!stopping) await sleep(800);
    }
  } finally {
    clearInterval(heartbeatTimer);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  console.log(`[${name}] stopped processed=${processed}`);
}

export async function executeLeasedTask(client, task, execute, acquiredAt = Date.now()) {
  const lease = startTaskLease(client, task, acquiredAt);
  const resultPrefix = `result_${task.taskId}_${task.attempt || 1}`;
  try {
    if (!lease.isActive()) return;
    const ack = await client.ack(task);
    if (ack.status !== 200 || !lease.isActive()) return;
    const result = await execute(task, {
      signal: lease.signal,
      async reportRunning(content) {
        if (!lease.isActive()) throw new Error('lease lost');
        const response = await client.result(task, {
          resultId: `${resultPrefix}_running`, status: 'running', content, writeBack: false,
        });
        if (response.status !== 200) throw new Error('running result rejected');
      },
    });
    if (!lease.isActive()) return;
    const response = await client.result(task, { ...result, resultId: `${resultPrefix}_final` });
    if (response.status !== 200 && response.status !== 409) throw new Error('result rejected');
  } finally {
    // Keep renewing through result submission, and ignore late renewal responses after stop.
    lease.stop();
  }
}
