#!/usr/bin/env node
/** Protocol-level gate for the Codex Runner using a real Relay and fake Codex JSONL process. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { listenRelay, closeDb } from '../src/relay/server.js';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function startMockWorkPanel(port, groupId, writeBacks) {
  const group = { id: groupId, name: 'Codex Runner Gate', adminMemberId: 'agent-codex' };
  const members = [
    { id: 'user-root', kind: 'user', displayName: 'root', isActive: true, authUserId: 'u-root' },
    { id: 'agent-codex', kind: 'agent', displayName: 'Codex-Windows11', isActive: true },
  ];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const send = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === '/api/health') return send(200, { ok: true });
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return send(200, { token: 'mock-session', user_id: 'u-root', username: 'root', isAdmin: true });
      }
      if (url.pathname === '/api/presence' && request.method === 'GET') return send(200, { onlineUserIds: ['u-root'] });
      if (url.pathname === '/api/presence/heartbeat' && request.method === 'POST') return send(200, { ok: true });
      if (url.pathname === '/api/groups' && request.method === 'GET') return send(200, [group]);
      if (url.pathname === `/api/groups/${groupId}` && request.method === 'GET') return send(200, { group, members });
      if (url.pathname === '/api/messages' && request.method === 'POST') {
        writeBacks.push(body);
        return send(200, { message: { id: `wp-${randomUUID()}` }, runIds: [] });
      }
      return send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function waitForOutput(child, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`runner output timeout: ${output}`)), timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString('utf8');
      if (pattern.test(output)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
  });
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-codex-runner-'));
  const configPath = path.join(temporary, 'relay.json');
  const databasePath = path.join(temporary, 'connector.db');
  const fakeCodexPath = path.join(temporary, 'fake-codex.mjs');
  const relayPort = Number(process.env.CONNECTER_CODEX_GATE_PORT || 19097);
  const workPanelPort = Number(process.env.CONNECTER_CODEX_GATE_WP_PORT || 19098);
  const groupId = 'group-codex-runner-gate';
  const runnerToken = `runner-${randomUUID()}`;
  const petToken = `pet-${randomUUID()}`;
  const writeBacks = [];

  fs.writeFileSync(fakeCodexPath, `
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }) + '\\n');
  setTimeout(() => {
    const text = prompt.includes('E2E_PROMPT') ? 'CODEX_RUNNER_E2E_OK' : 'UNEXPECTED_PROMPT';
    process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
  }, 4200);
});
`, 'utf8');

  const config = {
    listen: { host: '127.0.0.1', port: relayPort },
    db: { path: databasePath },
    auth: { tokens: ['ops-gate-token'] },
    allowProdFromPet: false,
    runnerHeartbeatTtlSec: 6,
    runnerTaskLeaseSec: 3,
    runnerTaskMaxAttempts: 2,
    directoryV2RoutingEnabled: true,
    backends: {
      canary: { baseUrl: `http://127.0.0.1:${workPanelPort}`, kind: 'workpanel', username: 'root', password: 'gate' },
    },
    defaults: { env: 'canary', group: 'Codex Runner Gate', coordinatorAgentName: 'Codex-Windows11' },
    pets: [{
      id: 'pet-codex-gate', name: 'Codex Gate Pet', token: petToken,
      groups: [{ env: 'canary', groupId, groupName: 'Codex Runner Gate', agentName: 'Codex-Windows11' }],
    }],
    runners: [{
      agentId: 'codex-windows-gate', displayName: 'Codex Windows Gate', token: runnerToken,
      agentType: 'codex', runtime: 'windows-local', protocolVersion: 2, maxConcurrency: 1,
      capabilities: [{ name: 'code.execute', version: '1' }],
      bindings: [{ env: 'canary', groupId, groupName: 'Codex Runner Gate', agentName: 'Codex-Windows11', workspace: process.cwd() }],
      codex: { command: process.execPath, commandArgs: [fakeCodexPath], workspace: process.cwd(), sessionMode: 'ephemeral', timeoutMs: 15000 },
    }],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const mockWorkPanel = await startMockWorkPanel(workPanelPort, groupId, writeBacks);
  const { server } = await listenRelay({ configPath, dbPath: databasePath, resume: false });
  const baseUrl = `http://127.0.0.1:${relayPort}`;
  const runner = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'codex-runner.js'), '--config', configPath, '--relay', baseUrl, '--agentId', 'codex-windows-gate', '--once'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let runnerStderr = '';
  runner.stderr.on('data', (chunk) => { runnerStderr += chunk.toString('utf8'); });

  try {
    await waitForOutput(runner, /registered agent=codex-windows-gate/);
    const messageId = `msg-${randomUUID()}`;
    const chat = await jsonFetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${petToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: messageId, group: 'Codex Runner Gate', prompt: '@Codex-Windows11\nE2E_PROMPT' }),
    });
    assert(chat.status === 200 && chat.body.runner?.agentId === 'codex-windows-gate', 'chat routed to Codex runner');
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { runner.kill(); reject(new Error('runner exit timeout')); }, 20000);
      runner.once('close', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert(exitCode === 0, `runner exited cleanly: ${runnerStderr}`);
    const run = await jsonFetch(`${baseUrl}/v1/runs/${messageId}`, {
      headers: { authorization: 'Bearer ops-gate-token' },
    });
    assert(run.status === 200 && run.body.status === 'completed', 'task completed after lease renewal');
    assert(writeBacks.some((item) => item.senderMemberId === 'agent-codex' && item.content === 'CODEX_RUNNER_E2E_OK'), 'result written back as Codex agent');
    console.log('CODEX_RUNNER_E2E_OK');
  } finally {
    if (runner.exitCode == null) runner.kill();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockWorkPanel.close(resolve));
    closeDb();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
