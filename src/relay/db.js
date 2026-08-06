import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db = null;
let _writeChain = Promise.resolve();

export function getDbPath(config, root) {
  const rel = config?.db?.path || 'data/connector.db';
  return path.isAbsolute(rel) ? rel : path.join(root, rel);
}

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  _db = db;
  return db;
}

export function db() {
  if (!_db) throw new Error('db not opened');
  return _db;
}

/** Serialize writes (WAL + single-process queue). */
export function writeTx(fn) {
  const run = () => {
    const database = db();
    database.exec('BEGIN');
    try {
      const result = fn(database);
      database.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  };
  const next = _writeChain.then(run, run);
  _writeChain = next.catch(() => {});
  return next;
}

export function closeDb() {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}

export function insertMessageOrGet(database, row) {
  try {
    database
      .prepare(
        `INSERT INTO messages (id, agent_instance_id, direction, envelope_json, status, retries)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.agent_instance_id,
        row.direction,
        row.envelope_json,
        row.status || 'accepted',
        row.retries || 0
      );
    return { inserted: true, row: getMessageById(database, row.id) };
  } catch (err) {
    if (String(err.message || err).includes('UNIQUE')) {
      return { inserted: false, row: getMessageById(database, row.id) };
    }
    throw err;
  }
}

export function getMessageById(database, id) {
  return database.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;
}

export function updateMessageStatus(database, id, status, retries) {
  database
    .prepare(
      `UPDATE messages SET status = ?, retries = COALESCE(?, retries), updated_at = datetime('now') WHERE id = ?`
    )
    .run(status, retries ?? null, id);
}

export function listMessagesSince(database, agentInstanceId, sinceSeq, limit = 50) {
  const since = Number(sinceSeq) || 0;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return database
    .prepare(
      `SELECT * FROM messages WHERE agent_instance_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
    )
    .all(agentInstanceId, since, lim);
}

export function listPendingAccepted(database) {
  return database
    .prepare(
      `SELECT * FROM messages WHERE direction = 'up' AND status = 'accepted' ORDER BY seq ASC`
    )
    .all();
}

export function insertDeliveryLog(database, { message_id, target, attempt, result }) {
  database
    .prepare(
      `INSERT INTO delivery_log (message_id, target, attempt, result) VALUES (?, ?, ?, ?)`
    )
    .run(message_id, target, attempt, result);
}

export function upsertRun(database, row) {
  database
    .prepare(
      `INSERT INTO runs (id, message_id, agent_instance_id, status, detail_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail_json = excluded.detail_json`
    )
    .run(row.id, row.message_id, row.agent_instance_id, row.status, row.detail_json || null);
}

export function getRun(database, id) {
  return database.prepare('SELECT * FROM runs WHERE id = ?').get(id) || null;
}
