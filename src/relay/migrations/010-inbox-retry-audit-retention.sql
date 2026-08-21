ALTER TABLE federation_inbox ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE federation_inbox ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 10;
ALTER TABLE federation_inbox ADD COLUMN available_at TEXT;
ALTER TABLE federation_inbox ADD COLUMN completion_error TEXT;

CREATE TABLE IF NOT EXISTS federation_run_terminals (
  correlation_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  origin_site TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_retention_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO audit_retention_context (id, enabled) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS audit_events_archive (
  id INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  actor TEXT,
  site_id TEXT,
  subject_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  message_id TEXT,
  task_id TEXT,
  policy_version TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TRIGGER IF EXISTS audit_events_no_update;
DROP TRIGGER IF EXISTS audit_events_no_delete;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
WHEN (SELECT enabled FROM audit_retention_context WHERE id=1) != 1
BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
WHEN (SELECT enabled FROM audit_retention_context WHERE id=1) != 1
BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE TRIGGER audit_events_archive_no_update BEFORE UPDATE ON audit_events_archive
BEGIN SELECT RAISE(ABORT, 'audit archive is append-only'); END;
CREATE TRIGGER audit_events_archive_no_delete BEFORE DELETE ON audit_events_archive
BEGIN SELECT RAISE(ABORT, 'audit archive is append-only'); END;

CREATE INDEX IF NOT EXISTS idx_fed_inbox_retry ON federation_inbox(status, available_at, received_at);
CREATE INDEX IF NOT EXISTS idx_audit_archive_trace ON audit_events_archive(trace_id, created_at);
