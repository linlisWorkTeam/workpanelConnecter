import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb } from '../src/relay/db.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-migrations-'));

function columns(database, table) {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

try {
  const freshPath = path.join(root, 'fresh.db');
  let database = openDb(freshPath);
  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  );
  assert(columns(database, 'runner_tasks').has('lease_until'));
  closeDb();

  database = openDb(freshPath);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 12);
  closeDb();

  const legacyPath = path.join(root, 'legacy.db');
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE runners (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL DEFAULT 'runner',
      role TEXT NOT NULL DEFAULT 'general',
      channel_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      runtime TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO runners (id,channel_id,token_hash,status)
    VALUES ('runner-old','channel-old','hash-old','active');
    CREATE TABLE runner_tasks (
      id TEXT PRIMARY KEY,
      runner_id TEXT NOT NULL,
      channel_id TEXT,
      env TEXT NOT NULL,
      group_id TEXT NOT NULL,
      agent_name TEXT,
      up_message_id TEXT,
      prompt TEXT NOT NULL,
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT,
      completed_at TEXT
    );
    INSERT INTO runner_tasks
      (id, runner_id, env, group_id, prompt, status, dispatched_at)
    VALUES ('task-old', 'runner-old', 'canary', 'group-old', 'hello', 'dispatched', datetime('now'));
  `);
  legacy.close();

  database = openDb(legacyPath);
  assert(columns(database, 'runner_tasks').has('lease_token_hash'));
  const upgraded = database.prepare(`SELECT attempt, lease_owner, lease_until FROM runner_tasks WHERE id = 'task-old'`).get();
  assert.equal(upgraded.attempt, 1);
  assert.equal(upgraded.lease_owner, 'runner-old');
  assert(upgraded.lease_until);
  assert.equal(database.prepare(`SELECT protocol_version FROM runners WHERE id='runner-old'`).get().protocol_version, 1);
  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  );
  closeDb();
  assert(fs.readdirSync(root).some((name) => name.startsWith('legacy.db.backup-')));

  const driftPath = path.join(root, 'drift.db');
  database = openDb(driftPath);
  database.prepare(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 2`).run();
  closeDb();
  assert.throws(() => openDb(driftPath), /migration checksum mismatch/);
  closeDb();

  console.log('MIGRATIONS_UNIT_OK');
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
