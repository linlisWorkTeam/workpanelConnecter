CREATE TABLE IF NOT EXISTS federation_routes (
  id TEXT PRIMARY KEY,
  group_ref TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  display_name TEXT,
  site_id TEXT NOT NULL,
  capabilities_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  UNIQUE(group_ref, subject_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_fed_routes_group ON federation_routes(group_ref, status, expires_at);
