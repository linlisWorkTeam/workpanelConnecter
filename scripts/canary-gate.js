#!/usr/bin/env node
/**
 * Canary gate — real LinlisWorkPanel :8081 (no mock coordinator).
 * Does NOT touch production :8080.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ROOT, loadConfig } from '../src/config.js';
import { Registry } from '../src/registry.js';
import { LogStore } from '../src/logStore.js';
import {
  cmdRefresh,
  cmdShowServer,
  cmdShowTeam,
  cmdChat,
  cmdShowLog,
} from '../src/commands.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const cfgPath =
    process.env.CONNECTER_CONFIG ||
    path.join(ROOT, 'config', 'servers.canary.json');
  assert(fs.existsSync(cfgPath), `missing canary config ${cfgPath}`);

  // Safety: refuse if someone points this gate at prod 8080
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  for (const s of raw.servers || []) {
    if (/:8080\b/.test(s.baseUrl || '')) {
      throw new Error('REFUSE: canary gate must not target production :8080');
    }
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-canary-gate-'));
  const config = loadConfig(cfgPath);
  const registry = new Registry(config.servers);
  const logs = new LogStore(dataDir);
  const ctx = { registry, logs };

  console.log(`CANARY_GATE config=${cfgPath}`);
  console.log(await cmdRefresh(ctx));
  console.log(cmdShowServer(ctx));

  const canary = registry.findServer('wp-canary');
  const dead = registry.findServer('wp-unreachable');
  assert(canary?.online === true, 'wp-canary must be online on :8081');
  assert(dead?.online === false, 'wp-unreachable must be offline');

  const teams = cmdShowTeam(ctx, 'wp-canary');
  console.log(teams);
  assert(/灰度测试/.test(teams), 'must list 灰度测试 team');

  const detail = cmdShowTeam(ctx, 'LinlisWorkPanel-Canary', '灰度测试');
  console.log(detail);
  assert(/team_metadata/.test(detail), 'must expose team_metadata from real group');
  assert(/Cursor Agent|coordinatorAgentName/i.test(detail), 'card should reference coordinator agent');

  const prompt = `Connecter canary-gate ping ${new Date().toISOString()} — 请仅确认收到，勿深层委派。`;
  const chat = await cmdChat(ctx, 'wp-canary', '灰度测试', prompt);
  console.log(chat.message);
  assert(chat.record?.status === 'accepted' || chat.record?.status === 'succeeded', 'canary chat must be accepted');
  assert(chat.record?.taskId, 'must return message/task id');
  assert(chat.record?.status !== 'failed', 'canary dispatch must not fail');

  const failed = await cmdChat(ctx, 'wp-unreachable', 'dead-group', 'should fail');
  console.log(failed.message);
  assert(failed.record?.status === 'failed', 'unreachable slot must fail');
  assert(/unavailable/i.test(failed.message) || /unavailable/i.test(failed.record.error || ''), 'fail closed');

  console.log(cmdShowLog(ctx, 5));
  console.log('\nCANARY_GATE_OK');
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        messageId: chat.record.taskId,
        canaryBase: canary.baseUrl,
        group: '灰度测试',
        note: 'no mock; real WP canary :8081; prod :8080 untouched',
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
