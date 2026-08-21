CREATE TABLE IF NOT EXISTS federation_policies (
  id TEXT PRIMARY KEY,
  origin_site TEXT NOT NULL,
  target_site TEXT NOT NULL,
  group_ref TEXT NOT NULL,
  subject_id TEXT,
  operation TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  data_classification TEXT NOT NULL DEFAULT 'internal',
  effect TEXT NOT NULL DEFAULT 'deny',
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(origin_site,target_site,group_ref,subject_id,operation,direction,version)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_message ON audit_events(message_id, created_at);

ALTER TABLE federation_messages ADD COLUMN policy_version TEXT;
ALTER TABLE federation_deliveries ADD COLUMN policy_version TEXT;
