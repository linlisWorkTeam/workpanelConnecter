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
import { reclaimExpiredTasksTx } from './services/taskQueueService.js';
import { parseRunnerRegistration } from './contracts/directory.js';
import { touchRunnerDirectory, upsertRunnerDirectoryTx } from './directory.js';
import { credentialAllowsRegistration, findCredentialForRunnerToken } from './credentialStore.js';
import { groupRef } from './services/identityService.js';
import { siteIdFor } from './directory.js';
import { logEvent } from './structuredLogger.js';

export function runnerHeartbeatTtlSec(config) {
  const n = Number(config?.runnerHeartbeatTtlSec);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function runnerTaskLeaseSec(config) {
  const n = Number(config?.runnerTaskLeaseSec);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3600) : 60;
}

export function runnerTaskMaxAttempts(config) {
  const n = Number(config?.runnerTaskMaxAttempts);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 3;
}

function runnerMaxConcurrency(config, runner) {
  try {
    const endpoint = db()
      .prepare(
        `SELECT e.max_concurrency FROM endpoints e
         JOIN subjects s ON s.subject_id=e.subject_id
         WHERE s.kind='agent' AND s.local_id=? AND e.status='active' LIMIT 1`
      )
      .get(runner?.id);
    if (Number(endpoint?.max_concurrency) > 0) return Math.min(Number(endpoint.max_concurrency), 50);
  } catch {
    /* pre-directory schema compatibility */
  }
  const provisioned = (config?.runners || []).find((item) => item.agentId === runner?.id);
  const n = Number(provisioned?.maxConcurrency);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 1;
}

function leaseDeadlineSql(seconds) {
  return `+${Math.max(1, Math.floor(seconds))} seconds`;
}

function resultContentHash(status, content) {
  return hashToken(JSON.stringify({ status, content: content ?? null }));
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
      const registration = parseRunnerRegistration({}, r);
      const channelId = r.channelId || `ch_${randomUUID()}`;
      database
        .prepare(
          `INSERT INTO runners (id, agent_type, role, channel_id, token_hash, status, runtime, protocol_version, last_seen_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             agent_type = excluded.agent_type,
             role = excluded.role,
             channel_id = excluded.channel_id,
             status = 'active',
             runtime = excluded.runtime,
             protocol_version = excluded.protocol_version`
        )
        .run(r.agentId, resolveRunnerAgentType(r), role, channelId, hashToken(r.token), r.runtime || 'local', registration.protocolVersion);

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
      upsertRunnerDirectoryTx(database, config, {
        runnerId: r.agentId,
        displayName: r.displayName || bindings[0]?.agentName || r.agentId,
        runtime: r.runtime || 'local',
        bindings: bindings.map((b) => ({
          groupId: b.groupId || b.group || b.id,
          groupRef: b.groupRef,
          role: role === 'special' ? 'special' : 'agent',
        })),
        registration,
        online: false,
      });
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
  const credential = findCredentialForRunnerToken(token, agentId);
  if (!provisioned && !credential) {
    return Promise.resolve({ status: 403, body: { error: 'agentId not provisioned' } });
  }
  if (provisioned && provisioned.token !== token && !credential) {
    return Promise.resolve({ status: 401, body: { error: 'token mismatch' } });
  }
  if (config?.enrollment?.requireDeviceCredentials === true && !credential) {
    return Promise.resolve({ status: 403, body: { error: 'approved device credential required', code: 'DEVICE_CREDENTIAL_REQUIRED' } });
  }
  const role = provisioned?.role === 'special' ? 'special' : 'general';
  const runtime = body.runtime || provisioned?.runtime || 'local';
  let registration;
  try {
    registration = parseRunnerRegistration(body, provisioned || {});
  } catch (error) {
    return Promise.resolve({ status: 400, body: { error: String(error.message || error), code: 'INVALID_RUNNER_REGISTRATION' } });
  }
  const baseUrl =
    config.publicBaseUrl || `http://127.0.0.1:${config.listen?.port || 80}`;

  return writeTx((database) => {
    const existing = database.prepare('SELECT * FROM runners WHERE id = ?').get(agentId);
    const channelId = existing?.channel_id || `ch_${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO runners (id, agent_type, role, channel_id, token_hash, status, runtime, protocol_version, last_seen_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           agent_type = excluded.agent_type,
           role = excluded.role,
           channel_id = excluded.channel_id,
           status = 'active',
           runtime = excluded.runtime,
           protocol_version = excluded.protocol_version,
           last_seen_at = datetime('now')`
      )
      .run(agentId, resolveRunnerAgentType(provisioned, body), role, channelId, hashToken(token), runtime, registration.protocolVersion);

    const groups = Array.isArray(body.groups) && body.groups.length
      ? body.groups
      : (provisioned?.bindings || []);
    if (!groups.length) {
      return { status: 400, body: { error: 'at least one group binding required', code: 'GROUP_BINDING_REQUIRED' } };
    }
    if (credential) {
      const siteId = siteIdFor(config);
      const allowed = credentialAllowsRegistration(credential, {
        siteId,
        groupRefs: groups.map((group) => group.groupRef || groupRef({ authority: siteId, groupId: group.groupId || group.group || group.id })),
        capabilities: registration.capabilities.map((item) => item.name),
      });
      if (!allowed) {
        return { status: 403, body: { error: 'credential scope does not allow registration', code: 'CREDENTIAL_SCOPE_DENIED' } };
      }
    }
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
    const directory = upsertRunnerDirectoryTx(database, config, {
      runnerId: agentId,
      displayName: body.displayName || provisioned?.displayName || groups[0]?.agentName || agentId,
      runtime,
      bindings: groups.map((group) => ({
        groupId: group.groupId || group.group || group.id,
        groupRef: group.groupRef,
        role: role === 'special' ? 'special' : 'agent',
      })),
      registration,
      online: true,
    });
    return {
      status: 200,
      body: {
        agentId,
        channelId,
        role,
        protocolVersion: registration.protocolVersion,
        subjectId: directory.subjectId,
        endpointId: directory.endpointId,
        taskUrl: `${baseUrl}/v1/agents/tasks`,
        heartbeatUrl: `${baseUrl}/v1/agents/heartbeat`,
      },
    };
  });
}

/** Persist an outbound task for a runner (chat target is runner-bound). */
export function enqueueRunnerTask({
  config,
  taskId: requestedTaskId,
  runnerId,
  channelId,
  env,
  groupId,
  agentName,
  upMessage,
  content,
  context,
  federation = null,
}) {
  return writeTx((database) => {
    const taskId = requestedTaskId || upMessage?.id || `task_${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO runner_tasks
          (id, runner_id, channel_id, env, group_id, agent_name, up_message_id, prompt, context_json, status, max_attempts, available_at,
           federation_origin_site, federation_message_id, federation_correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, datetime('now'), ?, ?, ?)
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
        context ? JSON.stringify(context) : null,
        runnerTaskMaxAttempts(config),
        federation?.originSite || null,
        federation?.messageId || null,
        federation?.correlationId || null
      );
    return database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
  });
}

/** Runner atomically claims queued tasks with a renewable fencing lease. */
export function pollRunnerTasks(config, runner, { limit = 1 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 1, 1), 50);
  const leaseSec = runnerTaskLeaseSec(config);
  const maxConcurrency = runnerMaxConcurrency(config, runner);
  return writeTx((database) => {
    reclaimExpiredTasksTx(database, { runnerId: runner.id, actor: `runner:${runner.id}` });

    const inflight = database
      .prepare(
        `SELECT COUNT(*) AS n FROM runner_tasks
         WHERE runner_id = ? AND status IN ('dispatched', 'leased', 'acknowledged', 'running')
           AND lease_until > datetime('now')`
      )
      .get(runner.id).n;
    const slots = Math.max(0, maxConcurrency - Number(inflight || 0));
    if (!slots) {
      return { status: 200, body: { tasks: [] } };
    }
    const rows = database
      .prepare(
        `SELECT * FROM runner_tasks
         WHERE runner_id = ? AND status = 'queued'
           AND attempt < max_attempts
           AND (available_at IS NULL OR available_at <= datetime('now'))
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(runner.id, Math.min(lim, slots));
    const claimed = [];
    for (const row of rows) {
      const leaseToken = `lease_${randomUUID()}_${randomUUID()}`;
      const updated = database
        .prepare(
          `UPDATE runner_tasks
           SET status = 'leased', dispatched_at = datetime('now'), lease_owner = ?,
               lease_token_hash = ?, lease_until = datetime('now', ?), attempt = attempt + 1,
               acknowledged_at = NULL, last_error = NULL
           WHERE id = ? AND status = 'queued'`
        )
        .run(runner.id, hashToken(leaseToken), leaseDeadlineSql(leaseSec), row.id);
      if (updated.changes === 1) claimed.push({ ...row, leaseToken, attempt: Number(row.attempt || 0) + 1 });
    }
    return {
      status: 200,
      body: {
        tasks: claimed.map((r) => ({
          taskId: r.id,
          leaseToken: r.leaseToken,
          leaseSec,
          attempt: r.attempt,
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

export function heartbeatRunner(config, runner, body = {}) {
  touchRunner(runner.id);
  const directory = touchRunnerDirectory(config, runner.id, { load: body.load });
  return { ok: true, agentId: runner.id, channelId: runner.channel_id, ...directory };
}

export function findRunnerBindingForRunner({ runnerId, env, groupId, agentName }) {
  return db()
    .prepare(
      `SELECT b.*, r.role AS runner_role, r.status AS runner_status, r.last_seen_at
       FROM runner_bindings b JOIN runners r ON r.id=b.runner_id
       WHERE b.runner_id=? AND b.env=? AND b.group_id=?
         AND (? IS NULL OR b.agent_name=?) AND b.status='active' AND r.status!='disabled'
       LIMIT 1`
    )
    .get(runnerId, env, groupId, agentName || null, agentName || null) || null;
}

function verifyTaskLease(config, task, runner, body) {
  if (task.runner_id !== runner.id) {
    return { status: 403, body: { error: 'task not owned by this runner', code: 'TASK_NOT_OWNED' } };
  }
  const supplied = String(body?.leaseToken || '');
  if (!supplied && config?.runnerProtocolCompatibility === 'v1' && Number(runner.protocol_version || 1) === 1) return null;
  if (!supplied) {
    return { status: 428, body: { error: 'leaseToken required', code: 'LEASE_TOKEN_REQUIRED' } };
  }
  if (!task.lease_token_hash || hashToken(supplied) !== task.lease_token_hash) {
    return { status: 409, body: { error: 'stale lease', code: 'STALE_LEASE', taskId: task.id } };
  }
  if (!task.lease_until) {
    return { status: 409, body: { error: 'lease is not active', code: 'STALE_LEASE', taskId: task.id } };
  }
  const fresh = db()
    .prepare(`SELECT CASE WHEN ? > datetime('now') THEN 1 ELSE 0 END AS fresh`)
    .get(task.lease_until).fresh;
  if (!fresh) {
    return { status: 409, body: { error: 'lease expired', code: 'STALE_LEASE', taskId: task.id } };
  }
  return null;
}

export function acknowledgeRunnerTask(config, runner, body) {
  const taskId = String(body?.taskId || '').trim();
  if (!taskId) return Promise.resolve({ status: 400, body: { error: 'taskId required' } });
  return writeTx((database) => {
    const task = database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found' } };
    const denied = verifyTaskLease(config, task, runner, body);
    if (denied) return denied;
    if (['completed', 'failed', 'cancelled', 'dead'].includes(task.status)) {
      return { status: 409, body: { error: 'task already terminal', code: 'TASK_TERMINAL', taskId } };
    }
    database
      .prepare(`UPDATE runner_tasks SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, datetime('now')) WHERE id = ?`)
      .run(taskId);
    return { status: 200, body: { ok: true, taskId, status: 'acknowledged' } };
  });
}

export function renewRunnerTask(config, runner, body) {
  const taskId = String(body?.taskId || '').trim();
  if (!taskId) return Promise.resolve({ status: 400, body: { error: 'taskId required' } });
  return writeTx((database) => {
    const task = database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found' } };
    const denied = verifyTaskLease(config, task, runner, body);
    if (denied) return denied;
    if (['completed', 'failed', 'cancelled', 'dead'].includes(task.status)) {
      return { status: 409, body: { error: 'task already terminal', code: 'TASK_TERMINAL', taskId } };
    }
    const leaseSec = runnerTaskLeaseSec(config);
    database
      .prepare(`UPDATE runner_tasks SET lease_until = datetime('now', ?) WHERE id = ?`)
      .run(leaseDeadlineSql(leaseSec), taskId);
    return { status: 200, body: { ok: true, taskId, leaseSec } };
  });
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
  const resultId = String(body.resultId || '').trim();
  const v1Compatibility = config?.runnerProtocolCompatibility === 'v1' && Number(runner.protocol_version || 1) === 1;
  if (!resultId && !v1Compatibility) {
    return Promise.resolve({ status: 400, body: { error: 'resultId required', code: 'RESULT_ID_REQUIRED' } });
  }
  const status = isPartial
    ? 'dispatched'
    : raw === 'failed' || raw === 'cancelled'
      ? raw
      : 'completed';
  return writeTx((database) => {
    const task = database.prepare('SELECT * FROM runner_tasks WHERE id = ?').get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found' } };
    const effectiveResultId = resultId || `v1_${taskId}_${raw}`;
    const contentHash = resultContentHash(raw, body.content);
    const prior = database
      .prepare(`SELECT * FROM runner_task_results WHERE task_id = ? AND result_id = ?`)
      .get(taskId, effectiveResultId);
    if (prior) {
      if (prior.status !== raw || prior.content_hash !== contentHash) {
        return { status: 409, body: { error: 'resultId payload conflict', code: 'RESULT_ID_CONFLICT', taskId } };
      }
      return { status: 200, body: { ...JSON.parse(prior.response_json), duplicate: true } };
    }
    const denied = verifyTaskLease(config, task, runner, body);
    if (denied) return denied;
    if (!isPartial && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
      return { status: 409, body: { error: 'task already terminal', taskId, status: task.status } };
    }

    const resultJson = body.content != null ? JSON.stringify({ content: body.content, phase: raw }) : null;
    if (isPartial) {
      database
        .prepare(`UPDATE runner_tasks SET status = 'running', result_json = ?, result_id = ? WHERE id = ?`)
        .run(resultJson, effectiveResultId, taskId);
    } else {
      database
        .prepare(
          `UPDATE runner_tasks
           SET status = ?, result_json = ?, result_id = ?, completed_at = datetime('now'),
               lease_token_hash = NULL, lease_until = NULL
           WHERE id = ?`
        )
        .run(status, resultJson, effectiveResultId, taskId);
    }

    const reportStatus = isPartial ? raw : status;
    if (task.up_message_id) {
      const up = getMessageById(database, task.up_message_id);
      if (up) {
        if (!isPartial) updateMessageStatus(database, up.id, status === 'completed' ? 'delivered' : 'failed', null);
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

    if (task.up_message_id) {
      const up = getMessageById(database, task.up_message_id);
      if (up) {
        upsertRun(database, {
          id: taskId,
          message_id: task.up_message_id,
          agent_instance_id: up.agent_instance_id,
          status: reportStatus,
          detail_json: resultJson,
        });
      }
    }
    const response = {
      ok: true, taskId, status: reportStatus, resultId: effectiveResultId,
      federation: task.federation_origin_site ? {
        originSite: task.federation_origin_site,
        messageId: task.federation_message_id,
        correlationId: task.federation_correlation_id,
      } : null,
    };
    database
      .prepare(
        `INSERT INTO runner_task_results (task_id, result_id, status, content_hash, response_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(taskId, effectiveResultId, raw, contentHash, JSON.stringify(response));
    return { status: 200, body: response };
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
    logEvent('warn', 'runner.workpanel_writeback_failed', {
      taskId: task.id, siteId: config?.host?.siteId || config?.siteId || null,
      subjectId: runner?.id || null, status: result.status, error: result.error || null,
    });
  }
  return result;
}
