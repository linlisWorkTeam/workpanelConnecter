import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runtimeRoot } from './runtimeRoot.js';

export const ROOT = runtimeRoot(import.meta.url, 1);

export function defaultConfigPath() {
  return (
    process.env.CONNECTER_CONFIG ||
    path.join(ROOT, 'config', 'servers.json')
  );
}

export function defaultDataDir() {
  return (
    process.env.CONNECTER_DATA ||
    path.join(os.homedir(), '.connecter')
  );
}

export function loadConfig(configPath = defaultConfigPath()) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    const example = path.join(ROOT, 'config', 'servers.example.json');
    throw new Error(
      `Config not found: ${resolved}\nCopy ${example} → ${resolved} (or set CONNECTER_CONFIG)`
    );
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(raw.servers)) {
    throw new Error('Config must have a "servers" array');
  }
  return { path: resolved, servers: raw.servers };
}

export function ensureDataDir(dir = defaultDataDir()) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
