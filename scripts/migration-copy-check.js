#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, openDb } from '../src/relay/db.js';
import { applyMigrations } from '../src/relay/migrations.js';

const source = path.resolve(process.argv[2] || 'data/connector.db');
if (!fs.existsSync(source)) throw new Error(`source database not found: ${source}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-migration-copy-'));
const copy = path.join(root, 'connector.db');
fs.copyFileSync(source, copy);

function counts(database) {
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((row) => row.name);
  const out = {};
  for (const table of ['pets', 'agent_instances', 'messages', 'runs', 'runners', 'runner_tasks']) {
    if (tables.includes(table)) out[table] = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  return out;
}

try {
  let raw = new DatabaseSync(copy);
  const before = counts(raw);
  raw.close();

  const upgraded = openDb(copy);
  const after = counts(upgraded);
  assert.deepEqual(after, before, 'upgrade preserves application row counts');
  const versions = upgraded
    .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
    .all()
    .map((row) => row.version);
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  closeDb();

  const migrationDir = path.join(root, 'migrations');
  fs.mkdirSync(migrationDir);
  for (const name of [
    '001-baseline.sql',
    '002-runner-task-lease.sql',
    '003-directory.sql',
    '004-enrollment.sql',
    '005-federation-host.sql',
    '006-federation-site.sql',
    '007-host-directory.sql',
    '008-policies-audit.sql',
    '009-telemetry-retention.sql',
    '010-inbox-retry-audit-retention.sql',
    '011-runner-protocol-version.sql',
    '012-policy-capability.sql',
    '013-workpanel-service-dispatch.sql',
  ]) {
    fs.copyFileSync(path.resolve('src/relay/migrations', name), path.join(migrationDir, name));
  }
  fs.writeFileSync(path.join(migrationDir, '014-intentional-failure.sql'), 'THIS IS NOT VALID SQL;');

  raw = new DatabaseSync(copy);
  const beforeFailure = counts(raw);
  const backupsBeforeFailure = fs.readdirSync(root).filter((name) => name.startsWith('connector.db.backup-')).length;
  assert.throws(
    () => applyMigrations(raw, { dbPath: copy, migrationsDir: migrationDir }),
    /syntax error|near "THIS"/i
  );
  assert.deepEqual(counts(raw), beforeFailure, 'failed migration rolls back application data');
  assert(fs.readdirSync(root).filter((name) => name.startsWith('connector.db.backup-')).length > backupsBeforeFailure,
    'failed migration preserves a pre-migration backup');
  assert.equal(
    raw.prepare(`SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 14`).get().n,
    0,
    'failed migration is not recorded'
  );
  raw.close();

  console.log(`MIGRATION_COPY_CHECK_OK source=${source} counts=${JSON.stringify(before)}`);
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
