/**
 * E1: DeepSeek Harness (dsh) runner registry + outbound task queue.
 *
 * Design (see docs/bridge-deepseek-harness.md §4.4):
 * - runners         : dsh instance identities (agentType='dsh'), token auth, channel, heartbeat
 * - runner_bindings : which (group, agent) is handled by which dsh runner
 *                     * role='special' -> WorkPanel self-maintenance group ONLY (at most one, root-designated)
 *                     * role='general'  -> any normal group chat, one @DeepSeek per group
 * - runner_tasks    : outbound queue. dsh is a resident runner that PULLS tasks from Connecter
 *                     (NAT-friendly: no inbound port, no SSH tunnel). ACP is the on-runner exec protocol.
 */
import { randomUUID } from 'node:crypto';
import { db, writeTx, getMessageById, updateMessageStatus, upsertRun, insertMessageOrGet } from './db.js';
import { hashToken } from './registry.js';
import { makeEnvelope } from './messaging.js';
import { postAsAgent } from '../workpanelClient.js';

function upsertBinding(database, { runnerId, role, channelId, env, groupId, groupName, agentName }) {
  const id = `${runnerId}:${env}:${groupId}:${agentName}`;
  database
    .prepare(
      `INSERT INTO runner_bindings
        (id, runner_id, role, channel_id, env, group_id, group_name, agent_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT(env, group_id, agent_name, role) DO UPDATE SET
         runner_id = excluded.runner_id,
         channel_id = excluded.channel_id,
         group_name = excluded.group_name,
         status = 'active'`
    )
    .run(id, runnerId, role, channelId, env, groupId, groupName, agentName);
}

/** Bootstrap config.runners (N1-style static registration) -> runners + bindings. */
export function syncConfigRunners(config) {
  const runners = config.runners || [];
  return writeTx((database) => {
    const out = [];
    for (const r of runners) {
      if (!r?.agentId || !r?.token) {
        throw new Error('runners[] requires agentId and token');
      }
      const role = r.role === 'special' ? 'special' : 'general';
      const channelId = r.channelId || `ch_${randomUUID()}`;
      database
        .prepare(
          `INSERT INTO runners (id, agent_type, role, channel_id, token_hash, status, runtime, last_seen_at)
           VALUES (?, 'dsh', ?, ?, ?, 'active', ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             role = excluded.role,
             channel_id = excluded.channel_id,
             status = 'active',
             runtime = excluded.runtime,
             last_seen_at = datetime('now')`
        )
        .run(r.agentId, role, channelId, hashToken(r.token), r.runtime || 'local');

      const bindings = r.bindings || [];
      for (const b of bindings) {
        const env = b.env || config.defaults?.env || 'canary';
        const groupId = b.groupId || b.group || b.id;
        const groupName = b.groupName || b.name || groupId;
        const agentName = b.agentName || 'DeepSeek';
        if (!groupId) throw new Error(`runner ${r.agentId} binding missing groupId`);
        upsertBinding(database, { runnerId: r.agentId, role, channelId, env, groupId, groupName, agentName });
        out.push({ runnerId: r.agentId, env, groupId, agentName });
      }
    }
    return out;
  });
}

export function findRunnerByToken(token) {
  const tokenHash = hashToken(token);
  return db().prepare('SELECT * FROM runners WHERE token_hash = ?').get(tokenHash) || null;
}

export function touchRunner(runnerId) {
  db()
    .prepare(`UPDATE runners SET last_seen_at = datetime('now'), status = 'active' WHERE id = ?`)
    .run(runnerId);
}

/** Look up the dsh binding that currently owns a (group, agent) in an env. */
export function findRunnerBinding(instance) {
  if (!instance) return null;
  return (
    db()
      .prepare(
        `SELECT b.*, r.role AS runner_role, r.status AS runner_status
         FROM runner_bindings b
         JOIN runners r ON r.id = b.runner_id
         WHERE b.env = ? AND b.group_id = ? AND b.agent_name = ?
           AND b.status = 'active' AND r.status = 'active'`
      )
      .get(instance.env, instance.group_id, instance.agent_name) || null
  );
}

/** Dynamic register (B7): a provisioned dsh registers itself + its group bindings. */
export function registerRunner(config, body) {
  const agentId = String(body.agentId || '').trim();
  const token = String(body.token || '');
  if (!agentId || !token) {
    return Promise.resolve({ status: 400, body: { error: 'agentId and token required' } });
  }
  const provisioned = (config.runners || []).find((r) => r.agentId === agentId);
  if (!provisioned) {
    return Promise.resolve({ status: 403, body: { error: 'agentId not provisioned' } });
  }
  if (provisioned.token !== token) {
    return Promise.resolve({ status: 401, body: { error: 'token mismatch' } });
  }
  const role = provisioned.role === 'special' ? 'special' : 'general';
  const runtime = body.runtime || provisioned.runtime || 'local';
  const baseUrl =
    config.publicBaseUrl || `http://127.0.0.1:${config.listen?.port || 80}`;

  return writeTx((database) => {
    const existing = database.prepare('SELECT * FROM runners WHERE id = ?').get(agentId);
    const channelId = existing?.channel_id || `ch_${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO runners (id, agent_type, role, channel_id, token_hash, status, runtime, last_seen_at)
         VALUES (?, 'dsh', ?, ?, ?, 'active', ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           role = excluded.role,
           channel_id = excluded.channel_id,
           status = 'active',
           runtime = excluded.runtime,
           last_seen_at = datetime('now')`
      )
      .run(agentId, role, channelId, hashToken(token), runtime);

    const groups = Array.isArray(body.groups) && body.groups.length
      ? body.groups
      : (provisioned.bindings || []);
    for (const g of groups) {
      const env = g.env || config.defaults?.env || 'canary';
      const groupId = g.groupId || g.group || g.id;
      const groupName = g.groupName || g.name || groupId;
      const agentName = g.agentName || 'DeepSeek';
      if (!groupId) {
        return { status: 400, body: { error: 'group requires groupId' } };
      }
      try {
        upsertBinding(database, { runnerId: agentId, role, channelId, env, groupId, groupName, agentName });
      } catch (err) {
        if (String(err.message || err).includes('UNIQUE')) {
          return {
            status: 409,
            body: { error: `binding conflict: only one dsh per (group, role) — ${groupId}/${agentName}` },
          };
        }
        throw err;
      }
    }
    return {
      status: 200,
      body: {
        agentId,
        channelId,
        role,
        taskUrl: `${baseUrl}/v1/agents/tasks`,
        heartbeatUrl: `${baseUrl}/v1/agents/heartbeat`,
      },
    };
  });
}

/** Persist an outbound task for a runner (called when a chat target is dsh-bound). */
export function enqueueRunnerTask({
  runnerId,
  channelId,
  env,
  groupId,
  agentName,
  upMessage,
  content,
  context,
}) {
  return writeTx((database) => {
    const taskId = upMessage?.id || `task_${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO runner_tasks
          (id, runner_id, channel_id, env, group_id, agent_name, up_message_id, prompt, context_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
         ON CONFLICT(id) DO NOTHING`
      )
      .run(
        taskId,
        runnerId,
        channelId,
        env,
        groupId,
        agentName,
        upMessage?.id || null,
        String(content),
        context ? JSON.stringify(context) : null
      );
    return database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
  });
}

/** Runner pulls queued tasks over its outbound channel (marks them dispatched). */
export function pollRunnerTasks(runner, { limit = 10 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  return writeTx((database) => {
    const rows = database
      .prepare(
        `SELECT * FROM runner_tasks
         WHERE channel_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(runner.channel_id, lim);
    for (const row of rows) {
      database
        .prepare(
          `UPDATE runner_tasks SET status = 'dispatched', dispatched_at = datetime('now')
           WHERE id = ? AND status = 'queued'`
        )
        .run(row.id);
    }
    return rows.map((r) => ({
      taskId: r.id,
      prompt: r.prompt,
      context: r.context_json ? JSON.parse(r.context_json) : null,
      env: r.env,
      groupId: r.group_id,
      agentName: r.agent_name,
      upMessageId: r.up_message_id,
    }));
  });
}

export function heartbeatRunner(runner) {
  touchRunner(runner.id);
  return { ok: true, agentId: runner.id, channelId: runner.channel_id };
}

/**
 * Runner submits a result. If the task came from a pet chat (up_message_id),
 * echo a down message for the pet poll (N2) and mark the up message delivered.
 * Full "write back to WorkPanel group thread" is E2.
 */
export function submitRunnerTaskResult(config, runner, body) {
  const taskId = String(body.taskId || '').trim();
  const status = body.status === 'failed' || body.status === 'cancelled' ? body.status : 'completed';
  if (!taskId) {
    return Promise.resolve({ status: 400, body: { error: 'taskId required' } });
  }
  return writeTx((database) => {
    const task = database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found' } };
    if (task.runner_id !== runner.id) {
      return { status: 403, body: { error: 'task not owned by this runner' } };
    }
    database
      .prepare(
        `UPDATE runner_tasks SET status = ?, result_json = ?, completed_at = datetime('now') WHERE id = ?`
      )
      .run(status, body.content != null ? JSON.stringify({ content: body.content }) : null, taskId);

    if (task.up_message_id) {
      const up = getMessageById(database, task.up_message_id);
      if (up) {
        updateMessageStatus(database, up.id, 'delivered', null);
        const upEnv = JSON.parse(up.envelope_json);
        const down = makeEnvelope({
          id: `msg_${randomUUID()}`,
          direction: 'down',
          conversation: upEnv.conversation.replace(/^grp_/, ''),
          from: { kind: 'agent', id: upEnv.to.id },
          to: { kind: 'pet', id: upEnv.from.id },
          content:
            body.content != null
              ? String(body.content)
              : JSON.stringify({ type: 'run.result', taskId, status }),
          ack: status === 'completed' ? 'delivered' : status,
        });
        insertMessageOrGet(database, {
          id: down.id,
          agent_instance_id: up.agent_instance_id,
          direction: 'down',
          envelope_json: JSON.stringify(down),
          status: status === 'completed' ? 'delivered' : 'failed',
          retries: 0,
        });
      }
    }

    upsertRun(database, {
      id: taskId,
      message_id: task.up_message_id || taskId,
      agent_instance_id: task.up_message_id
        ? getMessageById(database, task.up_message_id)?.agent_instance_id || null
        : null,
      status,
      detail_json: body.content != null ? JSON.stringify({ content: body.content }) : null,
    });
    return { status: 200, body: { ok: true, taskId, status } };
  });
}

/** Ops view of the runner registry. */
export function listRunnerBindings({ env, group } = {}) {
  let sql =
    `SELECT b.*, r.role AS runner_role, r.runtime, r.status AS runner_status, r.last_seen_at AS runner_last_seen
     FROM runner_bindings b
     JOIN runners r ON r.id = b.runner_id
     WHERE 1=1`;
  const params = [];
  if (env) {
    sql += ' AND b.env = ?';
    params.push(env);
  }
  if (group) {
    sql += ' AND (b.group_id = ? OR b.group_name = ?)';
    params.push(group, group);
  }
  sql += ' ORDER BY b.env, b.group_id, b.agent_name';
  return db().prepare(sql).all(...params);
}


/**
 * E2: best-effort write-back of a completed runner result into the WorkPanel group
 * thread, posted AS the named agent member. Errors are logged, never propagated
 * (so a dead/missing backend cannot break the outbound result loop).
 */
export async function postRunnerResultToGroup(config, runner, body) {
  const taskId = String(body?.taskId || '').trim();
  const task = taskId ? db().prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId) : null;
  if (!task || task.status !== 'completed') {
    return { ok: false, error: 'no completed task to write back' };
  }
  const backend = config.backends?.[task.env];
  if (!backend || backend.kind !== 'workpanel') {
    return { ok: false, error: `no workpanel backend for env ${task.env}` };
  }
  const content = body?.content != null ? String(body.content) : '(no content)';
  const result = await postAsAgent(
    {
      kind: 'workpanel',
      baseUrl: backend.baseUrl,
      auth: backend.auth || {},
    },
    { groupId: task.group_id, agentName: task.agent_name || 'DeepSeek', content }
  );
  if (!result.ok) {
    console.warn(`[runner] group write-back failed for ${task.id}: ${result.status} ${result.error || ''}`);
  }
  return result;
}
