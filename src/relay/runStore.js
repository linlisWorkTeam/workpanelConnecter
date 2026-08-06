import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * In-memory + optional JSONL persistence for accepted chats / run ids.
 */
export class RunStore {
  constructor({ dataDir } = {}) {
    this.dataDir =
      dataDir ||
      process.env.CONNECTER_RELAY_DATA ||
      path.join(os.homedir(), '.connecter-relay');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.file = path.join(this.dataDir, 'runs.jsonl');
    this.byId = new Map();
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.messageId) this.byId.set(row.messageId, row);
        for (const rid of row.runIds || []) {
          this.byId.set(rid, row);
        }
      } catch {
        /* skip */
      }
    }
  }

  put(record) {
    const row = { ...record, at: record.at || new Date().toISOString() };
    if (row.messageId) this.byId.set(row.messageId, row);
    for (const rid of row.runIds || []) {
      this.byId.set(rid, row);
    }
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n', 'utf8');
    return row;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  recent(limit = 10) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l };
        }
      })
      .reverse();
  }
}
