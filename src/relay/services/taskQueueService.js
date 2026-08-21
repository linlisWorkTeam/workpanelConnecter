import { db, writeTx } from '../db.js';
import { appendTaskAuditTx, listTaskAudit } from './deadLetterService.js';

const ACTIVE = ['dispatched', 'leased', 'acknowledged', 'running'];
const TERMINAL = ['completed', 'failed', 'cancelled', 'dead'];

export function reclaimExpiredTasksTx(database, { runnerId = null, actor = 'system' } = {}) {
  let sql =
    `SELECT * FROM runner_tasks
     WHERE status IN ('dispatched', 'leased', 'acknowledged', 'running')
       AND lease_until IS NOT NULL AND lease_until <= datetime('now')`;
  const params = [];
  if (runnerId) {
    sql += ' AND runner_id = ?';
    params.push(runnerId);
  }
  const expired = database.prepare(sql).all(...params);
  const out = [];
  for (const task of expired) {
    const dead = Number(task.attempt || 0) >= Number(task.max_attempts || 3);
    const status = dead ? 'dead' : 'queued';
    const reason = dead ? 'lease_expired_max_attempts' : 'lease_expired';
    database
      .prepare(
        `UPDATE runner_tasks
         SET status = ?, available_at = CASE WHEN ? = 'queued' THEN datetime('now') ELSE available_at END,
             lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL,
             acknowledged_at = NULL, last_error = ?
         WHERE id = ?`
      )
      .run(status, status, reason, task.id);
    appendTaskAuditTx(database, {
      taskId: task.id,
      action: dead ? 'dead' : 'lease_reclaimed',
      actor,
      reason,
      detail: { attempt: task.attempt, maxAttempts: task.max_attempts },
    });
    out.push({ taskId: task.id, status, reason });
  }
  return out;
}

export function reclaimExpiredTasks(options = {}) {
  return writeTx((database) => reclaimExpiredTasksTx(database, options));
}

export function listTasks({ status, runnerId, limit = 100 } = {}) {
  let sql = `SELECT * FROM runner_tasks WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (runnerId) {
    sql += ' AND runner_id = ?';
    params.push(runnerId);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  return db()
    .prepare(sql)
    .all(...params)
    .map((task) => ({
      ...task,
      audit: listTaskAudit(db(), task.id),
    }));
}

export function requeueTask(taskId, { actor = 'ops', reason } = {}) {
  return writeTx((database) => {
    const task = database.prepare(`SELECT * FROM runner_tasks WHERE id = ?`).get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found', code: 'TASK_NOT_FOUND' } };
    if (task.status === 'completed') {
      return { status: 409, body: { error: 'completed task cannot be requeued', code: 'TASK_TERMINAL' } };
    }
    database
      .prepare(
        `UPDATE runner_tasks
         SET status = 'queued', available_at = datetime('now'), lease_owner = NULL,
             lease_token_hash = NULL, lease_until = NULL, acknowledged_at = NULL,
             completed_at = NULL, last_error = NULL
         WHERE id = ?`
      )
      .run(taskId);
    appendTaskAuditTx(database, {
      taskId,
      action: 'requeued',
      actor,
      reason: String(reason || 'manual requeue'),
      detail: { previousStatus: task.status, attempt: task.attempt },
    });
    return { status: 200, body: { ok: true, taskId, status: 'queued' } };
  });
}

export function cancelTask(taskId, { actor = 'ops', reason } = {}) {
  return writeTx((database) => {
    const task = database.prepare(`SELECT * FROM runner_tasks WHERE id = ?`).get(taskId);
    if (!task) return { status: 404, body: { error: 'task not found', code: 'TASK_NOT_FOUND' } };
    if (TERMINAL.includes(task.status)) {
      if (task.status === 'cancelled') {
        return { status: 200, body: { ok: true, taskId, status: 'cancelled', duplicate: true } };
      }
      return { status: 409, body: { error: `task already ${task.status}`, code: 'TASK_TERMINAL' } };
    }
    database
      .prepare(
        `UPDATE runner_tasks
         SET status = 'cancelled', completed_at = datetime('now'), lease_owner = NULL,
             lease_token_hash = NULL, lease_until = NULL, last_error = ?
         WHERE id = ?`
      )
      .run(String(reason || 'cancelled by ops'), taskId);
    appendTaskAuditTx(database, {
      taskId,
      action: 'cancelled',
      actor,
      reason: String(reason || 'cancelled by ops'),
      detail: { previousStatus: task.status },
    });
    return { status: 200, body: { ok: true, taskId, status: 'cancelled' } };
  });
}

export function activeTaskStatuses() {
  return [...ACTIVE];
}
