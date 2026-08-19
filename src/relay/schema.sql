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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_channel_status ON runner_tasks(channel_id, status);
