#!/usr/bin/env node
/**
 * E2 live gate: temp Connecter relay + wp-runner against real canary :8081 (no mock, no :8080).
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/config.js';
import { listenRelay, closeDb } from '../src/relay/server.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const PORT = Number(process.env.CONNECTER_E2_PORT || 9098);
  const PET_TOKEN = 'e2-pet-token';
  const RUNNER_TOKEN = 'e2-runner-token';
  const OPS_TOKEN = 'e2-ops-token';
  const GROUP_ID = '528b36ba-4769-4b4d-9fa8-51e2de132396';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-e2-'));
  const cfgPath = path.join(tmp, 'relay.json');
  const dbPath = path.join(tmp, 'connector.db');

  const canaryUrl = 'http://127.0.0.1:8081';
  const health = await fetch(`${canaryUrl}/api/health`).catch(() => null);
  assert(health && health.ok, 'canary :8081 must be up (no mock fallback)');

  const config = {
    listen: { host: '127.0.0.1', port: PORT },
    db: { path: dbPath },
    auth: { tokens: [OPS_TOKEN] },
    allowProdFromPet: false,
    runnerHeartbeatTtlSec: 60,
    rateLimitPerMin: 120,
    backends: {
      canary: {
        baseUrl: canaryUrl,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
    defaults: { env: 'canary', group: '灰度测试', coordinatorAgentName: 'Cursor Agent' },
    pets: [
      {
        id: 'pet-e2',
        name: 'E2 Pet',
        token: PET_TOKEN,
        groups: [{ env: 'canary', groupId: GROUP_ID, groupName: '灰度测试', agentName: 'Cursor Agent' }],
      },
    ],
    runners: [
      {
        agentId: 'wp-canary-runner-1',
        token: RUNNER_TOKEN,
        agentType: 'workpanel',
        role: 'general',
        runtime: 'local',
        bindings: [{ env: 'canary', groupId: GROUP_ID, groupName: '灰度测试', agentName: 'Cursor Agent' }],
      },
    ],
  };
  assert(!/:8080\b/.test(JSON.stringify(config)), 'REFUSE prod :8080');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

  process.env.CONNECTER_RELAY_PORT = String(PORT);
  process.env.CONNECTER_RELAY_HOST = '127.0.0.1';
  const { server } = await listenRelay({ configPath: cfgPath, dbPath, resume: false });
  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/wp-runner.js')], {
    env: {
      ...process.env,
      CONNECTER_RELAY_URL: base,
      CONNECTER_RELAY_CONFIG: cfgPath,
      CONNECTER_RUNNER_ID: 'wp-canary-runner-1',
      CONNECTER_RUNNER_TOKEN: RUNNER_TOKEN,
      CONNECTER_WP_POLL_MS: '1500',
      CONNECTER_WP_WAIT_MS: '40000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[wp-runner] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[wp-runner] ${d}`));

  const marker = `E2_PONG_${randomUUID().slice(0, 8)}`;
  const prompt = `【Connecter E2 验收】请仅回复一行：${marker} 。不要委派、不要改代码。`;

  try {
    await sleep(1200);
    const chat = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PET_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `msg_e2_${randomUUID()}`, group: '灰度测试', prompt }),
    });
    assert(chat.status === 200, `chat ${chat.status} ${JSON.stringify(chat.body)}`);
    assert(chat.body.runner, 'must route to runner not raw WP session');

    let sawAccept = false;
    let sawFull = false;
    const deadline = Date.now() + 42000;
    while (Date.now() < deadline) {
      const poll = await jsonFetch(`${base}/v1/messages?since=0&group=${encodeURIComponent('灰度测试')}`, {
        headers: { authorization: `Bearer ${PET_TOKEN}` },
      });
      const downs = (poll.body.messages || []).filter((m) => m.direction === 'down');
      const texts = downs.map((m) => String(m.envelope?.payload?.content || ''));
      if (texts.some((t) => t.includes('wp_accepted'))) sawAccept = true;
      if (texts.some((t) => t.includes(marker))) sawFull = true;
      if (sawAccept && sawFull) break;
      await sleep(1500);
    }
    assert(sawAccept, 'missing first-phase wp_accepted in /v1/messages (real WP POST did not land)');
    assert(sawFull, `missing agent full text containing ${marker} (WP agent did not reply in time)`);
    console.log('\nE2_CANARY_RUNNER_OK');
    console.log(JSON.stringify({ at: new Date().toISOString(), marker, messageId: chat.body.messageId }, null, 2));
  } finally {
    child.kill('SIGTERM');
    server.close();
    closeDb();
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
