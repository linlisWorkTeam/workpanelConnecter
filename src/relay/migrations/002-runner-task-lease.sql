ALTER TABLE runner_tasks ADD COLUMN lease_owner TEXT;
ALTER TABLE runner_tasks ADD COLUMN lease_token_hash TEXT;
ALTER TABLE runner_tasks ADD COLUMN lease_until TEXT;
ALTER TABLE runner_tasks ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runner_tasks ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE runner_tasks ADD COLUMN available_at TEXT;
ALTER TABLE runner_tasks ADD COLUMN acknowledged_at TEXT;
ALTER TABLE runner_tasks ADD COLUMN last_error TEXT;
ALTER TABLE runner_tasks ADD COLUMN result_id TEXT;

CREATE TABLE IF NOT EXISTS runner_task_results (
  task_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, result_id),
  FOREIGN KEY (task_id) REFERENCES runner_tasks(id)
);

CREATE TABLE IF NOT EXISTS runner_task_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES runner_tasks(id)
);

UPDATE runner_tasks
SET lease_until = datetime('now', '+60 seconds'),
    lease_owner = runner_id,
    attempt = CASE WHEN attempt < 1 THEN 1 ELSE attempt END
WHERE status = 'dispatched' AND lease_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_runner_available
  ON runner_tasks(runner_id, status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lease_until
  ON runner_tasks(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_task_audit_task ON runner_task_audit(task_id, id);
