import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { relayResourceDir } from '../runtimeRoot.js';

const resourceDir = relayResourceDir(import.meta.url);
const DEFAULT_MIGRATIONS_DIR = path.join(resourceDir, 'migrations');
const DEFAULT_SCHEMA_PATH = path.join(resourceDir, 'schema.sql');

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function migrationChecksums(sql) {
  const canonical = checksum(sql.replace(/\r\n?/g, '\n'));
  return { canonical, accepted: new Set([canonical, checksum(sql)]) };
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function loadMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{3,}-.*\.sql$/i.test(entry.name))
    .map((entry) => {
      const file = path.join(migrationsDir, entry.name);
      const sql = fs.readFileSync(file, 'utf8');
      const version = Number(entry.name.match(/^(\d+)/)[1]);
      const checksums = migrationChecksums(sql);
      return {
        version,
        name: entry.name,
        file,
        sql,
        checksum: checksums.canonical,
        acceptedChecksums: checksums.accepted,
      };
    })
    .sort((a, b) => a.version - b.version);
}

function applicationTables(database) {
  return database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`
    )
    .all()
    .map((row) => row.name);
}

function hasMigrationTable(database) {
  return Boolean(
    database
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`)
      .get()
  );
}

function readApplied(database) {
  if (!hasMigrationTable(database)) return [];
  return database
    .prepare(`SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version`)
    .all();
}

function createBackup(database, dbPath) {
  if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) return null;
  database.exec('PRAGMA wal_checkpoint(FULL);');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-${stamp}`;
  database.exec(`VACUUM INTO ${sqlQuote(backupPath)}`);
  return backupPath;
}

function validateChecksums(applied, migrations) {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const current = byVersion.get(Number(row.version));
    if (!current) {
      throw new Error(`migration ${row.version} (${row.name}) is applied but missing from source`);
    }
    if (current.name !== row.name || !current.acceptedChecksums.has(row.checksum)) {
      throw new Error(`migration checksum mismatch: ${row.version} ${row.name}`);
    }
  }
}

/**
 * Bring a database to the latest schema.
 *
 * Fresh databases are created from schema.sql (the latest snapshot) and all
 * migrations currently shipped are recorded as applied. Legacy databases are
 * adopted at migration 001, backed up, then upgraded normally.
 */
export function applyMigrations(
  database,
  {
    dbPath,
    schemaPath = DEFAULT_SCHEMA_PATH,
    migrationsDir = DEFAULT_MIGRATIONS_DIR,
    backup = true,
  } = {}
) {
  const migrations = loadMigrations(migrationsDir);
  if (!migrations.length || migrations[0].version !== 1) {
    throw new Error('migration 001 baseline is required');
  }

  const tablesBefore = applicationTables(database);
  const fresh = tablesBefore.length === 0 && !hasMigrationTable(database);
  const appliedBefore = readApplied(database);
  validateChecksums(appliedBefore, migrations);

  const appliedVersions = new Set(appliedBefore.map((row) => Number(row.version)));
  const legacy = !fresh && !hasMigrationTable(database);
  if (legacy) appliedVersions.add(1);
  const pending = fresh ? [] : migrations.filter((migration) => !appliedVersions.has(migration.version));
  const backupPath = backup && (legacy || pending.length) ? createBackup(database, dbPath) : null;

  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         checksum TEXT NOT NULL,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    );

    if (fresh) {
      database.exec(fs.readFileSync(schemaPath, 'utf8'));
      const insert = database.prepare(
        `INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)`
      );
      for (const migration of migrations) {
        insert.run(migration.version, migration.name, migration.checksum);
      }
    } else {
      if (legacy) {
        const baseline = migrations[0];
        database
          .prepare(`INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)`)
          .run(baseline.version, baseline.name, baseline.checksum);
      }
      for (const migration of pending) {
        database.exec(migration.sql);
        database
          .prepare(`INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)`)
          .run(migration.version, migration.name, migration.checksum);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }

  const applied = readApplied(database);
  validateChecksums(applied, migrations);
  return { applied, backupPath, fresh, legacy };
}
