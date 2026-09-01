CREATE TABLE IF NOT EXISTS workpanel_dispatches (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  group_ref TEXT NOT NULL,
  target_subject_id TEXT NOT NULL,
  target_site TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  federation_message_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  result_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(service_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_workpanel_dispatches_service_created
  ON workpanel_dispatches(service_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workpanel_dispatches_trace
  ON workpanel_dispatches(trace_id);
