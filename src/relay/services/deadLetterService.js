export function appendTaskAuditTx(
  database,
  { taskId, action, actor = 'system', reason = null, detail = null }
) {
  database
    .prepare(
      `INSERT INTO runner_task_audit (task_id, action, actor, reason, detail_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(taskId, action, actor, reason, detail == null ? null : JSON.stringify(detail));
}

export function listTaskAudit(database, taskId) {
  return database
    .prepare(
      `SELECT id, task_id, action, actor, reason, detail_json, created_at
       FROM runner_task_audit WHERE task_id = ? ORDER BY id`
    )
    .all(taskId)
    .map((row) => ({
      id: row.id,
      taskId: row.task_id,
      action: row.action,
      actor: row.actor,
      reason: row.reason,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
      createdAt: row.created_at,
    }));
}
