CREATE TABLE IF NOT EXISTS enrollment_requests (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  local_id TEXT NOT NULL,
  display_name TEXT,
  public_key TEXT,
  metadata_json TEXT,
  requested_scopes_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL UNIQUE,
  public_key TEXT,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  revoked_at TEXT,
  rotated_from TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(subject_id),
  FOREIGN KEY(rotated_from) REFERENCES device_credentials(id)
);

CREATE INDEX IF NOT EXISTS idx_enrollment_status ON enrollment_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credentials_subject_status ON device_credentials(subject_id, status, expires_at);
