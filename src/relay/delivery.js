import { listPendingAccepted, db } from './db.js';
import { markDelivered, markFailed } from './messaging.js';
import { dispatchWorkPanel } from '../workpanelClient.js';
import { enqueueRunnerTask, findRunnerBinding, isRunnerHeartbeatFresh, runnerHeartbeatTtlSec } from './runners.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backendAsServer(backend) {
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth: backend.auth || {},
  };
}

export async function deliverOnce(config, messageRow) {
  const envelope = JSON.parse(messageRow.envelope_json);
  const instance = db()
    .prepare(`SELECT * FROM agent_instances WHERE id = ?`)
    .get(messageRow.agent_instance_id);
  if (!instance) {
    await markFailed(messageRow.id, 'agent_instance missing', 3);
    return { ok: false, error: 'agent_instance missing' };
  }

  if (instance.env === 'prod' && config.allowProdFromPet === false) {
    await markFailed(messageRow.id, 'prod forbidden', 3);
    return { ok: false, error: 'prod forbidden' };
  }

  const binding = findRunnerBinding(instance);
  if (binding) {
    if (!isRunnerHeartbeatFresh(binding, runnerHeartbeatTtlSec(config))) {
      await markFailed(messageRow.id, 'runner_offline', 3);
      return { ok: false, error: 'runner_offline' };
    }
    const task = await enqueueRunnerTask({
      runnerId: binding.runner_id,
      channelId: binding.channel_id,
      env: instance.env,
      groupId: instance.group_id,
      groupName: instance.group_name,
      agentName: instance.agent_name,
      upMessage: messageRow,
      content: envelope.payload?.content || '',
    });
    return { ok: true, runIds: [task.id], runner: true };
  }


  const backend = config.backends?.[instance.env];
  if (!backend) {
    await markFailed(messageRow.id, `unknown env ${instance.env}`, 3);
    return { ok: false, error: 'unknown env' };
  }

  const server = backendAsServer(backend);
  const team = {
    id: instance.group_id,
    name: instance.group_name || instance.group_id,
    coordinatorAgentName: instance.agent_name,
  };
  const payload = envelope.payload || {};
  const content = payload.content || '';

  const result = await dispatchWorkPanel(server, team, content, {
    petName: payload.petName,
    mentionAgentName: payload.mentionAgentName,
    formattedContent: payload.formatted ? payload.content : undefined,
  });
  if (!result.ok) {
    const retries = (messageRow.retries || 0) + 1;
    await markFailed(messageRow.id, result.error, retries);
    return { ok: false, error: result.error, retries };
  }

  await markDelivered(messageRow.id, {
    runIds: result.body?.runIds || [],
    wpMessageId: result.body?.messageId || result.taskId,
    detail: result.body,
  });
  return {
    ok: true,
    runIds: result.body?.runIds || [],
    wpMessageId: result.body?.messageId || result.taskId,
  };
}

/** Retry ≤3 with exponential backoff; then dead letter. */
export async function deliverWithRetry(config, messageRow, { maxAttempts = 3 } = {}) {
  let row = messageRow;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await deliverOnce(config, row);
    if (r.ok) return r;
    lastErr = r.error;
    row = {
      ...row,
      retries: r.retries ?? attempt,
    };
    if ((r.retries ?? attempt) >= maxAttempts) break;
    await sleep(100 * 2 ** (attempt - 1));
    // reload
    row = db().prepare('SELECT * FROM messages WHERE id = ?').get(messageRow.id);
    if (!row || row.status === 'failed' || row.status === 'delivered') break;
  }
  return { ok: false, error: lastErr || 'delivery failed' };
}

export async function resumePending(config) {
  const pending = listPendingAccepted(db());
  const results = [];
  for (const row of pending) {
    results.push({ id: row.id, ...(await deliverWithRetry(config, row)) });
  }
  return results;
}
