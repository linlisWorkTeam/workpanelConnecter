CREATE TABLE IF NOT EXISTS federation_outbox (
  id TEXT PRIMARY KEY,
  origin_site TEXT NOT NULL,
  message_id TEXT NOT NULL,
  target_site TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0,
  available_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(origin_site, message_id)
);

CREATE TABLE IF NOT EXISTS federation_inbox (
  id TEXT PRIMARY KEY,
  origin_site TEXT NOT NULL,
  message_id TEXT NOT NULL,
  host_lease_token TEXT,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(origin_site, message_id)
);

ALTER TABLE runner_tasks ADD COLUMN federation_origin_site TEXT;
ALTER TABLE runner_tasks ADD COLUMN federation_message_id TEXT;
ALTER TABLE runner_tasks ADD COLUMN federation_correlation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fed_outbox_status ON federation_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_fed_inbox_status ON federation_inbox(status, received_at);
