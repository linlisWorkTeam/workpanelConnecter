#!/usr/bin/env node
/**
 * Outbound WP slot register (ops token). WP itself can call the same HTTP later.
 * Usage: node scripts/wp-slot-register.js --baseUrl http://127.0.0.1:8082 --name canary [--loop]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function loadRelay() {
  const p = process.env.CONNECTER_RELAY_CONFIG || path.join(ROOT, 'config', 'relay.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function main() {
  const cfg = loadRelay();
  const token = cfg.auth?.tokens?.[0];
  if (!token) {
    console.error('relay.json auth.tokens[0] missing');
    process.exit(1);
  }
  const listen = cfg.listen || {};
  const host = listen.host === '0.0.0.0' ? '127.0.0.1' : listen.host || '127.0.0.1';
  const relayBase = arg('relay', `http://${host}:${listen.port || 9080}`).replace(/\/+$/, '');
  const name = arg('name', 'canary');
  const baseUrl = arg('baseUrl', cfg.backends?.[name]?.baseUrl || 'http://127.0.0.1:8082');
  const loop = process.argv.includes('--loop');
  const body = {
    name,
    baseUrl,
    kind: 'workpanel',
    auth: cfg.backends?.[name]?.auth || cfg.backends?.canary?.auth,
  };
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  async function once(pathName) {
    const res = await fetch(`${relayBase}${pathName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(pathName.endsWith('heartbeat') ? { name } : body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${pathName} ${res.status} ${json.error || ''}`);
    }
    return json;
  }

  const registered = await once('/v1/backends/register');
  console.log('WP_SLOT_REGISTER_OK', registered.slot?.name, registered.slot?.baseUrl);
  if (!loop) return;

  const ttlMs = Math.max(15_000, ((Number(cfg.wpSlotHeartbeatTtlSec) || 90) * 1000) / 2);
  console.log(`heartbeat every ${Math.round(ttlMs / 1000)}s (Ctrl+C to stop)`);
  setInterval(() => {
    once('/v1/backends/heartbeat').catch((err) => console.error(String(err.message || err)));
  }, ttlMs);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
