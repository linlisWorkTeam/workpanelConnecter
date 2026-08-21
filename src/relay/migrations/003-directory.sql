CREATE TABLE IF NOT EXISTS subjects (
  subject_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  local_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, kind, local_id)
);

CREATE TABLE IF NOT EXISTS endpoints (
  endpoint_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  runtime TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  load REAL NOT NULL DEFAULT 0,
  labels_json TEXT,
  last_seen_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);

CREATE TABLE IF NOT EXISTS capabilities (
  endpoint_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  labels_json TEXT,
  limits_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(endpoint_id, name, version),
  FOREIGN KEY(endpoint_id) REFERENCES endpoints(endpoint_id)
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  group_ref TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  permissions_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_ref, subject_id),
  FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);

CREATE TABLE IF NOT EXISTS presence_observations (
  subject_id TEXT NOT NULL,
  source TEXT NOT NULL,
  state TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  detail_json TEXT,
  PRIMARY KEY(subject_id, source),
  FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);

CREATE TABLE IF NOT EXISTS route_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  group_ref TEXT NOT NULL,
  target_subject_id TEXT,
  selected_endpoint_id TEXT,
  policy_version TEXT NOT NULL,
  reason TEXT NOT NULL,
  considered_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subjects_site_kind ON subjects(site_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_endpoints_subject_status ON endpoints(subject_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_memberships_group_status ON memberships(group_ref, status);
CREATE INDEX IF NOT EXISTS idx_presence_expires ON presence_observations(state, expires_at);
