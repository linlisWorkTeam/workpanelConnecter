#!/usr/bin/env node
/**
 * E2E：杀进程重启续投（补充门禁缺口）
 *
 * 场景：消息落盘 accepted 后、投递完成前进程被杀 → 重启后 resumePending 应续投到 canary。
 * 做法：临时配置+临时 DB 起 relay(:9191) → 直插一条 status='accepted' 消息（模拟投递中崩溃）
 *       → kill -9 → 重启 → 轮询 DB 断言 status='delivered' 且 runs 有记录 → 清理。
 * 注：会向 canary「灰度测试」群发一条真实消息（预期行为）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = 9199; // 专用测试端口（9191 被其他项目 python3 服务占用）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workpet-e2e-'));
const dbPath = path.join(tmp, 'connector.db');
const cfgPath = path.join(tmp, 'relay.json');

const GROUP_ID = '528b36ba-4769-4b4d-9fa8-51e2de132396';
const TOKEN = 'e2e-pet-token-' + Date.now();
const MSG_ID = 'msg_resume_e2e_' + Date.now();

const config = {
  listen: { host: '127.0.0.1', port: PORT },
  db: { path: dbPath },
  auth: { tokens: ['e2e-ops-token'] },
  allowProdFromPet: false,
  rateLimitPerMin: 60,
  backends: {
    canary: {
      baseUrl: 'http://127.0.0.1:8081',
      kind: 'workpanel',
      auth: { username: 'root', password: 'root' },
    },
  },
  defaults: { env: 'canary', group: '灰度测试', coordinatorAgentName: 'Cursor Agent' },
  pets: [
    {
      id: 'pet-e2e',
      name: 'E2E Pet',
      token: TOKEN,
      groups: [
        { env: 'canary', groupId: GROUP_ID, groupName: '灰度测试', agentName: 'Cursor Agent' },
      ],
    },
  ],
};
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

function startRelay() {
  const child = spawn('node', ['bin/connecter-relay.js'], {
    cwd: root,
    env: {
      ...process.env,
      CONNECTER_RELAY_CONFIG: cfgPath,
      CONNECTER_RELAY_PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function waitHealth(child, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) throw new Error('relay exited early: ' + child.exitCode);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/health`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('relay health timeout');
}

function stop(child, signal = 'SIGKILL') {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill(signal);
  });
}

function openDb() {
  return new DatabaseSync(dbPath);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1) 起 relay，等健康
  let relay = startRelay();
  await waitHealth(relay);
  console.log('✅ relay up on :' + PORT);

  // 2) 直插 pending 消息（模拟投递中崩溃：accepted 未 delivered）
  {
    const db = openDb();
    const inst = db
      .prepare(`SELECT id FROM agent_instances WHERE pet_id = ? AND env = 'canary'`)
      .get('pet-e2e');
    if (!inst) throw new Error('agent_instance not registered');
    const envelope = {
      id: MSG_ID,
      type: 'chat.text',
      direction: 'up',
      conversation: GROUP_ID,
      from: { kind: 'pet', id: 'pet-e2e' },
      to: { kind: 'agent', id: 'Cursor Agent' },
      payload: { content: 'resume-e2e: 杀进程重启续投验证' },
      ts: Date.now(),
      ack: 'accepted',
    };
    db.prepare(
      `INSERT INTO messages(id, agent_instance_id, direction, envelope_json, status, retries)
       VALUES(?, ?, 'up', ?, 'accepted', 0)`
    ).run(MSG_ID, inst.id, JSON.stringify(envelope));
    db.close();
    console.log('✅ pending 消息已注入: ' + MSG_ID);
  }

  // 3) 杀进程（模拟崩溃）
  await stop(relay, 'SIGKILL');
  console.log('✅ relay killed (SIGKILL)');

  // 4) 重启 → 启动时 resumePending 续投
  relay = startRelay();
  await waitHealth(relay);
  console.log('✅ relay restarted, resumePending should deliver');

  // 5) 轮询 DB：delivered + runs
  let delivered = false;
  let runs = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const db = openDb();
    const row = db.prepare(`SELECT status FROM messages WHERE id = ?`).get(MSG_ID);
    runs = db.prepare(`SELECT COUNT(*) c FROM runs WHERE message_id = ?`).get(MSG_ID).c;
    db.close();
    if (row && row.status === 'delivered' && runs >= 1) {
      delivered = true;
      break;
    }
    await sleep(500);
  }

  if (!delivered) {
    console.error('❌ 消息未在 30s 内续投成功');
    process.exitCode = 1;
  } else {
    console.log(`✅ 续投成功：status=delivered, runs=${runs}`);
    console.log('\nRESUME_E2E_OK');
  }

  // 6) 清理
  await stop(relay, 'SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('🧹 临时目录已清理');
} catch (e) {
  console.error('RESUME_E2E_FAIL —', e.message);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(1);
}
