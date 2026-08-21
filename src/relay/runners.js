/**
 * E1/E2: pluggable outbound runner registry + task queue.
 *
 * Runners are NOT bound to DeepSeek. Any process that speaks /v1/agents/*
 * (wp-runner, future dsh, other agents) can plug in. Pull is NAT-friendly.
 */
import { randomUUID } from 'node:crypto';
import { db, writeTx, getMessageById, updateMessageStatus, upsertRun, insertMessageOrGet } from './db.js';
import { hashToken } from './registry.js';
import { makeEnvelope } from './messaging.js';
import { postAsAgent } from '../workpanelClient.js';

export function runnerHeartbeatTtlSec(config) {
  const n = Number(config?.runnerHeartbeatTtlSec);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function defaultBindingAgentName(g, config) {
  return g?.agentName || config?.defaults?.coordinatorAgentName || 'Runner';
}

export function resolveRunnerAgentType(provisioned, body) {
  return body?.agentType || provisioned?.agentType || 'runner';
}

/** last_seen_at from SQLite datetime('now') (UTC, space-separated). */
export function isRunnerHeartbeatFresh(row, ttlSec = 60) {
  const last = row?.last_seen_at;
  if (!last) return false;
  const age = db()
    .prepare(`SELECT CAST(strftime('%s','now') - strftime('%s', ?) AS INTEGER) AS age`)
    .get(last);
  return Number(age?.age) >= 0 && Number(age.age) <= ttlSec;
}

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
           VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             agent_type = excluded.agent_type,
             role = excluded.role,
             channel_id = excluded.channel_id,
             status = 'active',
             runtime = excluded.runtime`
        )
        .run(r.agentId, resolveRunnerAgentType(r), role, channelId, hashToken(r.token), r.runtime || 'local');

      const bindings = r.bindings || [];
      for (const b of bindings) {
        const env = b.env || config.defaults?.env || 'canary';
        const groupId = b.groupId || b.group || b.id;
        const groupName = b.groupName || b.name || groupId;
        const agentName = defaultBindingAgentName(b, config);
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

/** Look up the runner binding that owns a (group, agent) in an env (may be stale heartbeat). */
export function findRunnerBinding(instance) {
  if (!instance) return null;
  return (
    db()
      .prepare(
        `SELECT b.*, r.role AS runner_role, r.status AS runner_status, r.last_seen_at
         FROM runner_bindings b
         JOIN runners r ON r.id = b.runner_id
         WHERE b.env = ? AND b.group_id = ? AND b.agent_name = ?
           AND b.status = 'active' AND r.status != 'disabled'`
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
         VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           agent_type = excluded.agent_type,
           role = excluded.role,
           channel_id = excluded.channel_id,
           status = 'active',
           runtime = excluded.runtime,
           last_seen_at = datetime('now')`
      )
      .run(agentId, resolveRunnerAgentType(provisioned, body), role, channelId, hashToken(token), runtime);

    const groups = Array.isArray(body.groups) && body.groups.length
      ? body.groups
      : (provisioned.bindings || []);
    for (const g of groups) {
      const env = g.env || config.defaults?.env || 'canary';
      const groupId = g.groupId || g.group || g.id;
      const groupName = g.groupName || g.name || groupId;
      const agentName = defaultBindingAgentName(g, config);
      if (!groupId) {
        return { status: 400, body: { error: 'group requires groupId' } };
      }
      try {
        upsertBinding(database, { runnerId: agentId, role, channelId, env, groupId, groupName, agentName });
      } catch (err) {
        if (String(err.message || err).includes('UNIQUE')) {
          return {
            status: 409,
            body: { error: `binding conflict: only one runner per (group, role) — ${groupId}/${agentName}` },
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

/** Persist an outbound task for a runner (chat target is runner-bound). */
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

/** Runner pulls queued tasks (at most one in-flight dispatched per runner). */
export function pollRunnerTasks(runner, { limit = 1 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 1, 1), 50);
  return writeTx((database) => {
    const inflight = database
      .prepare(
        `SELECT id FROM runner_tasks WHERE runner_id = ? AND status = 'dispatched' LIMIT 1`
      )
      .get(runner.id);
    if (inflight) {
      return { status: 200, body: { tasks: [] } };
    }
    const rows = database
      .prepare(
        `SELECT * FROM runner_tasks
         WHERE runner_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(runner.id, lim);
    for (const row of rows) {
      database
        .prepare(
          `UPDATE runner_tasks SET status = 'dispatched', dispatched_at = datetime('now')
           WHERE id = ? AND status = 'queued'`
        )
        .run(row.id);
    }
    return {
      status: 200,
      body: {
        tasks: rows.map((r) => ({
          taskId: r.id,
          prompt: r.prompt,
          context: r.context_json ? JSON.parse(r.context_json) : null,
          env: r.env,
          groupId: r.group_id,
          agentName: r.agent_name,
          upMessageId: r.up_message_id,
        })),
      },
    };
  });
}

/**
 * HTTP handler envelope for POST /v1/agents/tasks.
 * writeTx is async; callers that treat the raw poll as an array (or {tasks})
 * make server.js call writeHead(undefined) → 500.
 */
export function asAgentTasksResult(pulled) {
  if (pulled && typeof pulled.status === 'number' && pulled.body && Array.isArray(pulled.body.tasks)) {
    return pulled;
  }
  if (Array.isArray(pulled)) {
    return { status: 200, body: { tasks: pulled } };
  }
  if (pulled && Array.isArray(pulled.tasks)) {
    return { status: 200, body: { tasks: pulled.tasks } };
  }
  if (pulled && pulled.body && Array.isArray(pulled.body.tasks)) {
    const status = typeof pulled.status === 'number' ? pulled.status : 200;
    return { status, body: pulled.body };
  }
  return { status: 200, body: { tasks: [] } };
}

export function heartbeatRunner(runner) {
  touchRunner(runner.id);
  return { ok: true, agentId: runner.id, channelId: runner.channel_id };
}

/**
 * Runner submits a result.
 * status=running|accepted → down message only, task stays dispatched (two-phase).
 * completed|failed|cancelled → terminal; marks up delivered.
 */
export function submitRunnerTaskResult(config, runner, body) {
  const taskId = String(body.taskId || '').trim();
  if (!taskId) {
    return Promise.resolve({ status: 400, body: { error: 'taskId required' } });
  }
  const raw = String(body.status || 'completed');
  const isPartial = raw === 'running' || raw === 'accepted';
  const status = isPartial
    ? 'dispatched'
    : raw === 'failed' || raw === 'cancelled'
      ? raw
      : 'completed';
  return writeTx((database) => {
    const task = database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found' } };
    if (task.runner_id !== runner.id) {
      return { status: 403, body: { error: 'task not owned by this runner' } };
    }
    if (!isPartial && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
      return { status: 409, body: { error: 'task already terminal', taskId, status: task.status } };
    }

    const resultJson = body.content != null ? JSON.stringify({ content: body.content, phase: raw }) : null;
    if (isPartial) {
      database
        .prepare(`UPDATE runner_tasks SET result_json = ? WHERE id = ?`)
        .run(resultJson, taskId);
    } else {
      database
        .prepare(
          `UPDATE runner_tasks SET status = ?, result_json = ?, completed_at = datetime('now') WHERE id = ?`
        )
        .run(status, resultJson, taskId);
    }

    const reportStatus = isPartial ? raw : status;
    if (task.up_message_id) {
      const up = getMessageById(database, task.up_message_id);
      if (up) {
        if (!isPartial) updateMessageStatus(database, up.id, 'delivered', null);
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
              : JSON.stringify({ type: 'run.result', taskId, status: reportStatus }),
          ack: reportStatus === 'completed' ? 'delivered' : reportStatus,
        });
        insertMessageOrGet(database, {
          id: down.id,
          agent_instance_id: up.agent_instance_id,
          direction: 'down',
          envelope_json: JSON.stringify(down),
          status: reportStatus === 'failed' || reportStatus === 'cancelled' ? 'failed' : 'delivered',
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
      status: reportStatus,
      detail_json: resultJson,
    });
    return { status: 200, body: { ok: true, taskId, status: reportStatus } };
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
    { groupId: task.group_id, agentName: task.agent_name || 'Runner', content }
  );
  if (!result.ok) {
    console.warn(`[runner] group write-back failed for ${task.id}: ${result.status} ${result.error || ''}`);
  }
  return result;
}
