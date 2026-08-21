CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  event_name TEXT NOT NULL,
  site_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  message_id TEXT,
  subject_id TEXT,
  task_id TEXT,
  duration_ms INTEGER,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telemetry_trace ON telemetry_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_events(created_at);
