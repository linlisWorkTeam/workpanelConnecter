#!/usr/bin/env node
/** WorkPanel Runner gate: real Relay, delayed mock WorkPanel, short renewable lease. */
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
  let readyAt = Infinity;
  const group = { id: groupId, name: 'WorkPanel Runner Gate', adminMemberId: 'agent-remote' };
  const members = [
    { id: 'user-root', kind: 'user', displayName: 'root', isActive: true, authUserId: 'u-root' },
    { id: 'agent-remote', kind: 'agent', displayName: 'Remote-Agent', isActive: true },
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
        readyAt = Date.now() + 4200;
        return send(200, { message: { id: `wp-${randomUUID()}` }, runIds: ['wp-run'] });
      }
      if (url.pathname === `/api/groups/${groupId}/messages`) {
        return send(200, { messages: Date.now() >= readyAt
          ? [{ id: 'reply', parentRunId: 'wp-run', content: 'WP_RUNNER_E2E_OK' }] : [] });
      }
      return send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function startTransientPollProxy(port, targetPort, state) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/v1/agents/heartbeat') state.heartbeats += 1;
    if (url.pathname === '/v1/agents/tasks' && state.failures === 0) {
      state.failures += 1;
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'transient relay restart' }));
      return;
    }
    const upstream = http.request({
      hostname: '127.0.0.1', port: targetPort, path: request.url,
      method: request.method, headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'relay unavailable' }));
    });
    request.pipe(upstream);
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
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-wp-runner-'));
  const configPath = path.join(temporary, 'relay.json');
  const databasePath = path.join(temporary, 'connector.db');
  const relayPort = Number(process.env.CONNECTER_WP_RUNNER_GATE_PORT || 19107);
  const runnerProxyPort = relayPort + 2;
  const workPanelPort = Number(process.env.CONNECTER_WP_RUNNER_GATE_WP_PORT || 19108);
  const groupId = 'group-wp-runner-gate';
  const runnerToken = `runner-${randomUUID()}`;
  const petToken = `pet-${randomUUID()}`;
  const writeBacks = [];
  const proxyState = { failures: 0, heartbeats: 0 };

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
    defaults: { env: 'canary', group: 'WorkPanel Runner Gate', coordinatorAgentName: 'Remote-Agent' },
    pets: [{
      id: 'pet-wp-gate', name: 'WorkPanel Gate Pet', token: petToken,
      groups: [{ env: 'canary', groupId, groupName: 'WorkPanel Runner Gate', agentName: 'Remote-Agent' }],
    }],
    runners: [{
      agentId: 'workpanel-gate', displayName: 'WorkPanel Gate', token: runnerToken,
      agentType: 'workpanel', runtime: 'local', protocolVersion: 2, maxConcurrency: 1, heartbeatMs: 1000,
      capabilities: [{ name: 'code.execute', version: '1' }],
      bindings: [{ env: 'canary', groupId, groupName: 'WorkPanel Runner Gate', agentName: 'Remote-Agent', workspace: process.cwd() }],
    }],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const mockWorkPanel = await startMockWorkPanel(workPanelPort, groupId, writeBacks);
  const { server } = await listenRelay({ configPath, dbPath: databasePath, resume: false });
  const proxy = await startTransientPollProxy(runnerProxyPort, relayPort, proxyState);
  const baseUrl = `http://127.0.0.1:${runnerProxyPort}`;
  const runner = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'wp-runner.js'), '--config', configPath, '--relay', baseUrl, '--agentId', 'workpanel-gate', '--once'], {
    env: { ...process.env, CONNECTER_WP_POLL_MS: '100', CONNECTER_WP_WAIT_MS: '10000' },
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let runnerStderr = '';
  runner.stderr.on('data', (chunk) => { runnerStderr += chunk.toString('utf8'); });

  try {
    await waitForOutput(runner, /registered agent=workpanel-gate/);
    const messageId = `msg-${randomUUID()}`;
    const chat = await jsonFetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${petToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: messageId, group: 'WorkPanel Runner Gate', prompt: '@Remote-Agent\nE2E_PROMPT' }),
    });
    assert(chat.status === 200 && chat.body.runner?.agentId === 'workpanel-gate', 'chat routed to WorkPanel runner');
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { runner.kill(); reject(new Error('runner exit timeout')); }, 20000);
      runner.once('close', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert(exitCode === 0, `runner exited cleanly: ${runnerStderr}`);
    assert(proxyState.failures === 1, 'runner recovered after transient task poll failure');
    const run = await jsonFetch(`${baseUrl}/v1/runs/${messageId}`, {
      headers: { authorization: 'Bearer ops-gate-token' },
    });
    assert(run.status === 200 && run.body.status === 'completed', 'task completed after lease renewal');
    assert(writeBacks.length === 1, 'WorkPanel dispatch is sent once, with no duplicate final writeback');
    assert(proxyState.heartbeats >= 2, 'heartbeats continue during WorkPanel reply wait');
    console.log('WP_RUNNER_E2E_OK');
  } finally {
    if (runner.exitCode == null) runner.kill();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => mockWorkPanel.close(resolve));
    closeDb();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

