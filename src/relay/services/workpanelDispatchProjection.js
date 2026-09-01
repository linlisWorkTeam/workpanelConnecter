export function completeWorkpanelDispatchFromFederation(database, envelope) {
  const row = database.prepare(`SELECT * FROM workpanel_dispatches WHERE id=?`).get(envelope.correlationId);
  if (!row) return null;
  const rawStatus = String(envelope.payload?.status || 'failed');
  const status = ['completed', 'failed', 'cancelled'].includes(rawStatus) ? rawStatus : 'failed';
  const result = {
    content: Object.prototype.hasOwnProperty.call(envelope.payload || {}, 'content') ? envelope.payload.content : null,
    status,
    remoteTaskId: envelope.payload?.taskId || null,
  };
  if (['completed', 'failed', 'cancelled'].includes(row.status)) {
    let prior = null;
    try { prior = JSON.parse(row.result_json || 'null'); } catch {}
    const conflict = row.status !== status || JSON.stringify(prior) !== JSON.stringify(result);
    return { dispatchId: row.id, status: row.status, duplicate: !conflict, conflict };
  }
  database.prepare(
    `UPDATE workpanel_dispatches
     SET status=?,result_json=?,last_error=?,completed_at=datetime('now'),updated_at=datetime('now')
     WHERE id=?`
  ).run(status, JSON.stringify(result), status === 'completed' ? null : status, row.id);
  return { dispatchId: row.id, status };
}
