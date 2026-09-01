-- WorkConnector relay schema (Phase 1.5 / N3)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'pet',
  env TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pet_id, env, group_id, agent_name),
  FOREIGN KEY (pet_id) REFERENCES pets(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL,
  agent_instance_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pet_id) REFERENCES pets(id),
  FOREIGN KEY (agent_instance_id) REFERENCES agent_instances(id)
);

CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  agent_instance_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_instance_id) REFERENCES agent_instances(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  agent_instance_id TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (agent_instance_id) REFERENCES agent_instances(id)
);

CREATE TABLE IF NOT EXISTS delivery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  target TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  result TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_agent_seq ON messages(agent_instance_id, seq);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- =====================================================================
-- E1: DeepSeek Harness (dsh) runner registry (bridge-deepseek-harness.md)
-- =====================================================================

-- dsh runner identities (an "agent type"; can be multiple instances).
-- role: 'special' = only attachable to the WorkPanel self-maintenance group (bootstrap, root-designated once)
--       'general' = attachable to any normal group chat (one @DeepSeek per group)
CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY,                 -- agentId, e.g. 'dsh-dev-1'
  agent_type TEXT NOT NULL DEFAULT 'runner',
  role TEXT NOT NULL DEFAULT 'general',-- 'special' | 'general'
  channel_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',-- active | offline | disabled
  runtime TEXT,                        -- 'local' | 'remote'
  protocol_version INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- which (group, agent) is handled by which dsh runner (outbound channel).
CREATE TABLE IF NOT EXISTS runner_bindings (
  id TEXT PRIMARY KEY,                 -- '<runnerId>:<env>:<groupId>:<agentName>'
  runner_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'general',
  channel_id TEXT,
  env TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  agent_name TEXT NOT NULL DEFAULT 'Runner',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (env, group_id, agent_name, role),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

-- at most ONE special binding total (the WorkPanel self group)
CREATE UNIQUE INDEX IF NOT EXISTS uq_binding_special
  ON runner_bindings(role) WHERE role = 'special';
CREATE INDEX IF NOT EXISTS idx_bindings_channel ON runner_bindings(channel_id);

-- outbound task queue: dsh pulls tasks from Connecter (NAT-friendly, no inbound).
CREATE TABLE IF NOT EXISTS runner_tasks (
  id TEXT PRIMARY KEY,                 -- taskId (reuses up-message id when present)
  runner_id TEXT NOT NULL,
  channel_id TEXT,
  env TEXT NOT NULL,
  group_id TEXT NOT NULL,
  agent_name TEXT,
  up_message_id TEXT,
  prompt TEXT NOT NULL,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',-- queued | dispatched | completed | failed | cancelled
  result_json TEXT,
  result_id TEXT,
  lease_owner TEXT,
  lease_token_hash TEXT,
  lease_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT,
  acknowledged_at TEXT,
  last_error TEXT,
  federation_origin_site TEXT,
  federation_message_id TEXT,
  federation_correlation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_channel_status ON runner_tasks(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_runner_available
  ON runner_tasks(runner_id, status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lease_until ON runner_tasks(status, lease_until);

-- WorkPanel third-party provider projection. Execution remains in runner_tasks
-- (or the existing federation outbox); this table owns API auth/idempotency/state.
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
CREATE INDEX IF NOT EXISTS idx_task_audit_task ON runner_task_audit(task_id, id);

-- WP backend slots (CONNECTED SPACE env registry; overlay relay.json backends)
CREATE TABLE IF NOT EXISTS wp_slots (
  name TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'workpanel',
  auth_json TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Connecter peers registered at Connecter Host (outbound join from each site Connecter)
CREATE TABLE IF NOT EXISTS connecter_peers (
  site_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  label TEXT,
  public_base_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- P1 global subject directory and route projection.
CREATE TABLE IF NOT EXISTS subjects (
  subject_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, kind TEXT NOT NULL, local_id TEXT NOT NULL,
  display_name TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(site_id, kind, local_id)
);
CREATE TABLE IF NOT EXISTS endpoints (
  endpoint_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, protocol TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1, runtime TEXT, status TEXT NOT NULL DEFAULT 'active',
  max_concurrency INTEGER NOT NULL DEFAULT 1, load REAL NOT NULL DEFAULT 0, labels_json TEXT,
  last_seen_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);
CREATE TABLE IF NOT EXISTS capabilities (
  endpoint_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1', labels_json TEXT,
  limits_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(endpoint_id, name, version), FOREIGN KEY(endpoint_id) REFERENCES endpoints(endpoint_id)
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, group_ref TEXT NOT NULL, subject_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  permissions_json TEXT, status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_ref, subject_id), FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);
CREATE TABLE IF NOT EXISTS presence_observations (
  subject_id TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, detail_json TEXT,
  PRIMARY KEY(subject_id, source), FOREIGN KEY(subject_id) REFERENCES subjects(subject_id)
);
CREATE TABLE IF NOT EXISTS route_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL, group_ref TEXT NOT NULL,
  target_subject_id TEXT, selected_endpoint_id TEXT, policy_version TEXT NOT NULL,
  reason TEXT NOT NULL, considered_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subjects_site_kind ON subjects(site_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_endpoints_subject_status ON endpoints(subject_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_memberships_group_status ON memberships(group_ref, status);
CREATE INDEX IF NOT EXISTS idx_presence_expires ON presence_observations(state, expires_at);

-- P1 enrollment and credential lifecycle.
CREATE TABLE IF NOT EXISTS enrollment_requests (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, site_id TEXT NOT NULL, kind TEXT NOT NULL,
  local_id TEXT NOT NULL, display_name TEXT, public_key TEXT, metadata_json TEXT,
  requested_scopes_json TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT,
  reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS device_credentials (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL UNIQUE, public_key TEXT, scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', expires_at TEXT, revoked_at TEXT, rotated_from TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(subject_id) REFERENCES subjects(subject_id),
  FOREIGN KEY(rotated_from) REFERENCES device_credentials(id)
);
CREATE INDEX IF NOT EXISTS idx_enrollment_status ON enrollment_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credentials_subject_status ON device_credentials(subject_id, status, expires_at);

-- P2 durable federation transport.
CREATE TABLE IF NOT EXISTS federation_messages (
  id TEXT PRIMARY KEY, origin_site TEXT NOT NULL, message_id TEXT NOT NULL, target_site TEXT NOT NULL,
  group_ref TEXT NOT NULL, kind TEXT NOT NULL, envelope_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'accepted',
  expires_at TEXT NOT NULL, policy_version TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(origin_site, message_id)
);
CREATE TABLE IF NOT EXISTS federation_deliveries (
  id TEXT PRIMARY KEY, federation_id TEXT NOT NULL, target_site TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', lease_token_hash TEXT, lease_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT, acknowledged_at TEXT, completed_at TEXT, policy_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(federation_id, target_site), FOREIGN KEY(federation_id) REFERENCES federation_messages(id)
);
CREATE TABLE IF NOT EXISTS federation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, federation_id TEXT NOT NULL, site_id TEXT NOT NULL,
  status TEXT NOT NULL, detail_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(federation_id) REFERENCES federation_messages(id)
);
CREATE INDEX IF NOT EXISTS idx_fed_delivery_target_status ON federation_deliveries(target_site, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fed_delivery_lease ON federation_deliveries(status, lease_until);
CREATE TABLE IF NOT EXISTS federation_outbox (
  id TEXT PRIMARY KEY, origin_site TEXT NOT NULL, message_id TEXT NOT NULL, target_site TEXT NOT NULL,
  envelope_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0,
  available_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(origin_site, message_id)
);
CREATE TABLE IF NOT EXISTS federation_inbox (
  id TEXT PRIMARY KEY, origin_site TEXT NOT NULL, message_id TEXT NOT NULL, host_lease_token TEXT,
  envelope_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 10,
  available_at TEXT, completion_error TEXT, UNIQUE(origin_site, message_id)
);
CREATE INDEX IF NOT EXISTS idx_fed_outbox_status ON federation_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_fed_inbox_status ON federation_inbox(status, received_at);
CREATE INDEX IF NOT EXISTS idx_fed_inbox_retry ON federation_inbox(status, available_at, received_at);
CREATE TABLE IF NOT EXISTS federation_routes (
  id TEXT PRIMARY KEY, group_ref TEXT NOT NULL, subject_id TEXT NOT NULL, display_name TEXT,
  site_id TEXT NOT NULL, capabilities_json TEXT, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL, UNIQUE(group_ref, subject_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_fed_routes_group ON federation_routes(group_ref, status, expires_at);

CREATE TABLE IF NOT EXISTS federation_policies (
  id TEXT PRIMARY KEY, origin_site TEXT NOT NULL, target_site TEXT NOT NULL, group_ref TEXT NOT NULL,
  subject_id TEXT, operation TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'outbound',
  capability TEXT NOT NULL DEFAULT '*',
  data_classification TEXT NOT NULL DEFAULT 'internal', effect TEXT NOT NULL DEFAULT 'deny',
  version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(origin_site,target_site,group_ref,subject_id,operation,direction,version)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, outcome TEXT NOT NULL, actor TEXT,
  site_id TEXT, subject_id TEXT, trace_id TEXT, correlation_id TEXT, message_id TEXT, task_id TEXT,
  policy_version TEXT, detail_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_message ON audit_events(message_id, created_at);
CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info', event_name TEXT NOT NULL,
  site_id TEXT, trace_id TEXT, correlation_id TEXT, message_id TEXT, subject_id TEXT, task_id TEXT,
  duration_ms INTEGER, detail_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telemetry_trace ON telemetry_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry_events(created_at);

CREATE TABLE IF NOT EXISTS federation_run_terminals (
  correlation_id TEXT PRIMARY KEY, message_id TEXT NOT NULL, origin_site TEXT NOT NULL,
  status TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_retention_context (
  id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO audit_retention_context (id, enabled) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS audit_events_archive (
  id INTEGER PRIMARY KEY, event_type TEXT NOT NULL, outcome TEXT NOT NULL, actor TEXT,
  site_id TEXT, subject_id TEXT, trace_id TEXT, correlation_id TEXT, message_id TEXT, task_id TEXT,
  policy_version TEXT, detail_json TEXT, created_at TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_audit_archive_trace ON audit_events_archive(trace_id, created_at);
