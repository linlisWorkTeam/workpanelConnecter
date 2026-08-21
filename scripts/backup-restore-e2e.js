import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, db } from '../src/relay/db.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-backup-'));
const source = path.join(root, 'source.db');
const backup = path.join(root, 'backup.db');
try {
  openDb(source);
  db().prepare(`INSERT INTO pets (id,name,status) VALUES ('pet-backup','Backup Pet','active')`).run();
  db().exec('PRAGMA wal_checkpoint(FULL)');
  db().exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  closeDb();
  fs.copyFileSync(backup, path.join(root, 'restored.db'));
  openDb(path.join(root, 'restored.db'));
  assert.equal(db().prepare(`SELECT name FROM pets WHERE id='pet-backup'`).get().name, 'Backup Pet');
  assert.equal(db().prepare(`SELECT MAX(version) version FROM schema_migrations`).get().version, 12);
  console.log('BACKUP_RESTORE_E2E_OK');
} finally { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
