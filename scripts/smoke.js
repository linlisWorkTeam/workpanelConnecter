#!/usr/bin/env node
/**
 * MVP test gate — self-contained:
 * starts mock coordinator A, asserts acceptance criteria, tears down.
 * Exit 0 + SMOKE_OK on pass.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig } from '../src/config.js';
import { Registry } from '../src/registry.js';
import { LogStore } from '../src/logStore.js';
import {
  cmdRefresh,
  cmdShowServer,
  cmdShowTeam,
  cmdChat,
  cmdShowLog,
  cmdStub,
} from '../src/commands.js';

const MOCK_PORT = Number(process.env.SMOKE_MOCK_PORT || 19001);
const MOCK_SCRIPT = path.join(ROOT, 'mock', 'coordinator-server.js');

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERT: ${msg}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/coordinator/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(50);
  }
  throw new Error(`mock coordinator on :${port} did not become healthy`);
}

function startMock() {
  const child = spawn(process.execPath, [MOCK_SCRIPT], {
    env: {
      ...process.env,
      PORT: String(MOCK_PORT),
      TEAM_ID: 'team-a',
      TEAM_NAME: 'group-a',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  child.stdout.on('data', (d) => {
    tail += d.toString();
  });
  child.stderr.on('data', (d) => {
    tail += d.toString();
  });
  child._tail = () => tail;
  return child;
}

function stopMock(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

async function main() {
  const example = path.join(ROOT, 'config', 'servers.example.json');
  const cfgPath = path.join(ROOT, 'config', 'servers.json');
  if (!fs.existsSync(cfgPath)) {
    fs.copyFileSync(example, cfgPath);
  }

  const externalMock = process.env.CONNECTER_SMOKE_EXTERNAL_MOCK === '1';
  let mock = null;
  if (!externalMock) {
    mock = startMock();
    try {
      await waitHealthy(MOCK_PORT);
    } catch (err) {
      stopMock(mock);
      console.error(mock._tail?.() || '');
      throw err;
    }
  }

  try {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-smoke-'));
    const config = loadConfig(cfgPath);
    const registry = new Registry(config.servers);
    const logs = new LogStore(dataDir);
    const ctx = { registry, logs };

    const refreshMsg = await cmdRefresh(ctx);
    console.log(refreshMsg);
    const servers = registry.listServers();
    const svcA = registry.findServer('svc-a');
    const svcB = registry.findServer('svc-b');
    assert(svcA, 'svc-a must exist in config');
    assert(svcB, 'svc-b must exist in config');
    assert(svcA.online === true, 'svc-a must be online after refresh');
    assert(svcB.online === false, 'svc-b must be offline (no mock on 19002)');

    const showServer = cmdShowServer(ctx);
    console.log(showServer);
    assert(/svc-a/.test(showServer) && /yes/.test(showServer), 'show-server must list svc-a online');

    const teams = cmdShowTeam(ctx, 'svc-a');
    console.log(teams);
    assert(/team-a/.test(teams) && /yes/.test(teams), 'show-team svc-a must list team-a online');

    const detail = cmdShowTeam(ctx, 'WorkPanel-A', 'group-a');
    console.log(detail);
    assert(/team_metadata/.test(detail), 'show-team detail must include team_metadata');

    const chat = await cmdChat(ctx, 'svc-a', 'team-a', 'hello from smoke');
    console.log(chat.message);
    assert(chat.record && chat.record.status === 'succeeded', 'chat to online coordinator must succeed');
    assert(chat.record.taskId, 'successful chat must return taskId');

    const failed = await cmdChat(ctx, 'svc-b', 'team-b', 'should fail if B down');
    console.log(failed.message);
    assert(failed.record && failed.record.status === 'failed', 'chat to offline coordinator must fail');
    assert(
      /unavailable/i.test(failed.message) || /unavailable/i.test(failed.record.error || ''),
      'failure must mention coordinator unavailable'
    );
    assert(!/bypass/i.test(failed.message) || /No bypass/i.test(failed.message), 'must not bypass to workers');

    const logOut = cmdShowLog(ctx, 5);
    console.log(logOut);
    assert(/succeeded/.test(logOut) && /failed/.test(logOut), 'show-log must include success and failure');

    const stubRestart = cmdStub('/restart-server');
    const stubObs = cmdStub('/obs');
    console.log(stubRestart);
    console.log(stubObs);
    assert(/not implemented/i.test(stubRestart), 'restart-server stub');
    assert(/not implemented/i.test(stubObs), 'obs stub');

    assert(servers.length >= 2, 'config must have >=2 servers for online/offline paths');

    console.log('\nSMOKE_OK');
    console.log(`GATE_OK servers=${servers.length} dataDir=${dataDir}`);
  } finally {
    stopMock(mock);
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
