CREATE TABLE IF NOT EXISTS federation_messages (
  id TEXT PRIMARY KEY,
  origin_site TEXT NOT NULL,
  message_id TEXT NOT NULL,
  target_site TEXT NOT NULL,
  group_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'accepted',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(origin_site, message_id)
);

CREATE TABLE IF NOT EXISTS federation_deliveries (
  id TEXT PRIMARY KEY,
  federation_id TEXT NOT NULL,
  target_site TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  lease_token_hash TEXT,
  lease_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  acknowledged_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(federation_id, target_site),
  FOREIGN KEY(federation_id) REFERENCES federation_messages(id)
);

CREATE TABLE IF NOT EXISTS federation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  federation_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(federation_id) REFERENCES federation_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_fed_delivery_target_status ON federation_deliveries(target_site, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fed_delivery_lease ON federation_deliveries(status, lease_until);
