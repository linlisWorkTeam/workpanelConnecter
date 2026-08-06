import fs from 'node:fs';
import path from 'node:path';
import { ensureDataDir, defaultDataDir } from './config.js';

export class LogStore {
  constructor(dataDir = defaultDataDir()) {
    this.dir = ensureDataDir(dataDir);
    this.file = path.join(this.dir, 'dispatch.jsonl');
  }

  append(record) {
    const line = JSON.stringify({ ...record, at: record.at || new Date().toISOString() });
    fs.appendFileSync(this.file, line + '\n', 'utf8');
  }

  recent(limit = 10) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    }).reverse();
  }
}
