import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { groupRef, stableSubjectId } from '../src/relay/services/identityService.js';
import { createFederationEnvelope } from '../src/relay/contracts/federation.js';
import { signFederationEnvelope } from '../src/relay/envelopeSignature.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-fed-e2e-'));
const ports = { host: 19200, a: 19201, b: 19202, wp: 19203 };
const groupId = 'fed-group';
const ref = groupRef({ authority: 'site-a', groupId });
const localBGroupId = 'site-b-local-group';
const localBRef = groupRef({ authority: 'site-b', groupId: localBGroupId });
const policies = [
  { originSite: 'site-a', targetSite: 'site-b', groupRef: ref, subjectId: '*', operation: '*', direction: '*', effect: 'allow', version: 'e2e/v1' },
  { originSite: 'site-b', targetSite: 'site-a', groupRef: ref, subjectId: '*', operation: '*', direction: '*', effect: 'allow', version: 'e2e/v1' },
];
const federation = { policies, requireSignatures: true, requireSeparateSigningKey: true, requireExternalSigningKey: true, reconcileSec: 1 };
process.env.CONNECTER_TEST_SIGN_A = 'sign-secret-a';
process.env.CONNECTER_TEST_SIGN_B = 'sign-secret-b';
const keys = { a: [{ keyId: 'sign-a', secretEnv: 'CONNECTER_TEST_SIGN_A', status: 'active' }], b: [{ keyId: 'sign-b', secretEnv: 'CONNECTER_TEST_SIGN_B', status: 'active' }] };
const children = [];
const chaos = process.env.FEDERATION_CHAOS === '1';
const hostDataLoss = process.env.FEDERATION_HOST_DATA_LOSS === '1';
const originRestart = process.env.FEDERATION_ORIGIN_RESTART === '1';
const targetRestart = process.env.FEDERATION_TARGET_RESTART === '1';
const hostRestart = process.env.FEDERATION_HOST_RESTART === '1';
const workPanelOutage = process.env.FEDERATION_WORKPANEL_OUTAGE === '1';

function writeConfig(name, config) {
  const file = path.join(root, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function start(script, env = {}) {
  const child = spawn(process.execPath, [script], { cwd: path.resolve('.'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', (d) => { child.output += d; });
  child.stderr.on('data', (d) => { child.output += d; });
  children.push(child);
  return child;
}

async function call(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function eventually(fn, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} timeout: ${last?.stack || JSON.stringify(last)}`);
}

const hostConfig = writeConfig('host', {
  listen: { host: '127.0.0.1', port: ports.host }, db: { path: path.join(root, 'host.db') }, auth: { tokens: ['ops-host'] },
  host: { role: 'host', peers: [{ siteId: 'site-a', token: 'token-a', keys: keys.a }, { siteId: 'site-b', token: 'token-b', keys: keys.b }] }, pets: [], runners: [], backends: {},
  federation,
});
const siteAConfig = writeConfig('site-a', {
  listen: { host: '127.0.0.1', port: ports.a }, db: { path: path.join(root, 'a.db') }, auth: { tokens: ['ops-a'] },
  host: { role: 'connecter', siteId: 'site-a', baseUrl: `http://127.0.0.1:${ports.host}`, token: 'token-a', keys: keys.a, heartbeatMs: 300 },
  directoryV2RoutingEnabled: true, runnerHeartbeatTtlSec: 30,
  federation,
  backends: { canary: { kind: 'workpanel', baseUrl: `http://127.0.0.1:${ports.wp}`, auth: { username: 'root', password: 'pw' } } },
  defaults: { env: 'canary', group: groupId, coordinatorAgentName: 'DeepSeek' },
  pets: [{ id: 'pet-a', name: 'Pet A', token: 'pet-token-a', groups: [{ env: 'canary', groupId, groupName: 'Federation', agentName: 'DeepSeek' }] }], runners: [],
});
const siteBConfig = writeConfig('site-b', {
  listen: { host: '127.0.0.1', port: ports.b }, db: { path: path.join(root, 'b.db') }, auth: { tokens: ['ops-b'] },
  host: { role: 'connecter', siteId: 'site-b', baseUrl: `http://127.0.0.1:${ports.host}`, token: 'token-b', keys: keys.b, heartbeatMs: 300 },
  directoryV2RoutingEnabled: true, runnerHeartbeatTtlSec: 30, runnerTaskLeaseSec: 20,
  federation,
  backends: { canary: { kind: 'workpanel', baseUrl: `http://127.0.0.1:${ports.wp}`, auth: { username: 'root', password: 'pw' } } },
  pets: [{ id: 'pet-b', name: 'Pet B', token: 'pet-token-b', groups: [{ env: 'canary', groupId: localBGroupId, groupName: 'Site B local', agentName: 'DeepSeek' }] }],
  runners: [{ agentId: 'runner-b', displayName: 'DeepSeek', token: 'runner-token-b', protocolVersion: 2,
    capabilities: ['chat'], bindings: [
      { env: 'canary', groupId, groupRef: ref, groupName: 'Federation', agentName: 'DeepSeek' },
      { env: 'canary', groupId: localBGroupId, groupRef: localBRef, groupName: 'Site B local', agentName: 'DeepSeek' },
    ] }],
});

try {
  let wpChild = start(path.resolve('mock/workpanel-server.js'), { PORT: String(ports.wp), GROUP_ID: localBGroupId, GROUP_NAME: 'Site B local', GATE_GROUP_ID: groupId, GATE_GROUP_NAME: 'Federation', COORDINATOR_NAME: 'DeepSeek' });
  let hostChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: hostConfig });
  await eventually(async () => (await call(`http://127.0.0.1:${ports.host}`, '/health')).body.ok, 'host health');
  let siteBChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: siteBConfig });
  let siteAChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: siteAConfig });
  const baseA = `http://127.0.0.1:${ports.a}`;
  const baseB = `http://127.0.0.1:${ports.b}`;
  await eventually(async () => (await call(baseA, '/health')).body.ok, 'site A health');
  await eventually(async () => (await call(baseB, '/health')).body.ok, 'site B health');

  const runnerHeaders = { authorization: 'Bearer runner-token-b', 'content-type': 'application/json' };
  assert.equal((await call(baseB, '/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'runner-b', token: 'runner-token-b', protocolVersion: 2 }) })).status, 200);
  assert.equal((await call(baseB, '/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' })).status, 200);

  await eventually(async () => {
    const x = await call(baseA, `/v2/routes/explain?groupRef=${encodeURIComponent(ref)}&agentName=DeepSeek&sourceSiteId=site-a`, { headers: { authorization: 'Bearer ops-a' } });
    return x.body?.decision?.target?.siteId === 'site-b' && x;
  }, 'remote directory route');

  if (chaos) {
    hostChild.kill('SIGKILL');
    await new Promise((resolve) => hostChild.once('exit', resolve));
    const localWhileHostDown = await call(baseA, '/v1/chat', {
      method: 'POST', headers: { authorization: 'Bearer ops-a', 'content-type': 'application/json' },
      body: JSON.stringify({ env: 'canary', group: groupId, agent: 'DeepSeek', prompt: 'local path while Host is down' }),
    });
    assert.equal(localWhileHostDown.status, 200, JSON.stringify(localWhileHostDown.body));
    const localBHeaders = { authorization: 'Bearer pet-token-b', 'content-type': 'application/json' };
    const localBChat = await call(baseB, '/v1/chat', {
      method: 'POST', headers: localBHeaders,
      body: JSON.stringify({ id: `msg_local_b_${Date.now()}`, group: localBGroupId, prompt: 'site B local path while Host is down' }),
    });
    assert.equal(localBChat.status, 200, JSON.stringify(localBChat.body));
    assert.notEqual(localBChat.body.runner?.channelId, 'federation');
    const localBTask = await eventually(async () => {
      const pulled = await call(baseB, '/v1/agents/tasks', { method: 'POST', headers: runnerHeaders, body: '{}' });
      return pulled.body.tasks?.find((item) => item.prompt === 'site B local path while Host is down') || false;
    }, 'Site B local Runner task while Host down');
    await call(baseB, '/v1/agents/tasks/ack', { method: 'POST', headers: runnerHeaders,
      body: JSON.stringify({ taskId: localBTask.taskId, leaseToken: localBTask.leaseToken }) });
    const localBResult = await call(baseB, '/v1/agents/tasks/result', { method: 'POST', headers: runnerHeaders,
      body: JSON.stringify({ taskId: localBTask.taskId, leaseToken: localBTask.leaseToken,
        resultId: `result-local-b-${Date.now()}`, status: 'completed', content: 'site B local pong', writeBack: false }) });
    assert.equal(localBResult.status, 200, JSON.stringify(localBResult.body));
    await eventually(async () => {
      const feed = await call(baseB, `/v1/messages?since=0&group=${encodeURIComponent(localBGroupId)}`, { headers: localBHeaders });
      return feed.body.messages?.some((item) => item.direction === 'down' && item.envelope?.payload?.content === 'site B local pong');
    }, 'Site B local result while Host down');
    siteBChild.kill('SIGKILL');
    await new Promise((resolve) => siteBChild.once('exit', resolve));
  }
  if (hostDataLoss) {
    siteBChild.kill('SIGKILL');
    await new Promise((resolve) => siteBChild.once('exit', resolve));
  }

  const messageId = `msg_fed_${Date.now()}`;
  const petHeaders = { authorization: 'Bearer pet-token-a', 'content-type': 'application/json' };
  const chat = await call(baseA, '/v1/chat', { method: 'POST', headers: petHeaders, body: JSON.stringify({ id: messageId, group: groupId, prompt: 'federated ping' }) });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.runner.channelId, 'federation');
  assert.ok(chat.body.traceId);

  if (originRestart) {
    siteAChild.kill('SIGKILL');
    await new Promise((resolve) => siteAChild.once('exit', resolve));
    siteAChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: siteAConfig });
    await eventually(async () => (await call(baseA, '/health')).body.ok, 'origin Site recovery');
  }
  if (targetRestart) {
    siteBChild.kill('SIGKILL');
    await new Promise((resolve) => siteBChild.once('exit', resolve));
    siteBChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: siteBConfig });
    await eventually(async () => (await call(baseB, '/health')).body.ok, 'target Site recovery');
    await eventually(async () => (await call(baseB, '/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'runner-b', token: 'runner-token-b', protocolVersion: 2 }) })).status === 200, 'target Runner re-register');
    await call(baseB, '/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' });
  }
  if (hostRestart) {
    hostChild.kill('SIGKILL');
    await new Promise((resolve) => hostChild.once('exit', resolve));
    hostChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: hostConfig });
    await eventually(async () => (await call(`http://127.0.0.1:${ports.host}`, '/health')).body.ok, 'Host-only recovery');
  }

  if (hostDataLoss) {
    hostChild.kill('SIGKILL');
    await new Promise((resolve) => hostChild.once('exit', resolve));
    for (const suffix of ['', '-wal', '-shm']) {
      const target = path.join(root, `host.db${suffix}`);
      if (fs.existsSync(target)) fs.rmSync(target);
    }
  }

  if (chaos || hostDataLoss) {
    hostChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: hostConfig });
    await eventually(async () => (await call(`http://127.0.0.1:${ports.host}`, '/health')).body.ok, 'host recovery');
    siteBChild = start(path.resolve('bin/connecter-relay.js'), { CONNECTER_RELAY_CONFIG: siteBConfig });
    await eventually(async () => (await call(baseB, '/health')).body.ok, 'site B recovery');
    await eventually(async () => (await call(baseB, '/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'runner-b', token: 'runner-token-b', protocolVersion: 2 }) })).status === 200, 'runner recovery register');
    await call(baseB, '/v1/agents/heartbeat', { method: 'POST', headers: runnerHeaders, body: '{}' });
  }

  const task = await eventually(async () => {
    const pulled = await call(baseB, '/v1/agents/tasks', { method: 'POST', headers: runnerHeaders, body: '{}' });
    return pulled.body.tasks?.[0] || false;
  }, 'remote runner task');
  assert.equal(task.prompt, 'federated ping');
  await call(baseB, '/v1/agents/tasks/ack', { method: 'POST', headers: runnerHeaders, body: JSON.stringify({ taskId: task.taskId, leaseToken: task.leaseToken }) });
  if (workPanelOutage) {
    wpChild.kill('SIGKILL');
    await new Promise((resolve) => wpChild.once('exit', resolve));
  }
  const result = await call(baseB, '/v1/agents/tasks/result', { method: 'POST', headers: runnerHeaders,
    body: JSON.stringify({ taskId: task.taskId, leaseToken: task.leaseToken, resultId: `result-${Date.now()}`, status: 'completed', content: 'federated pong', writeBack: false }) });
  assert.equal(result.status, 200, JSON.stringify(result.body));

  const visible = await eventually(async () => {
    const feed = await call(baseA, `/v1/messages?since=0&group=${encodeURIComponent(groupId)}`, { headers: petHeaders });
    return feed.body.messages?.find((m) => m.direction === 'down' && m.envelope?.payload?.content === 'federated pong');
  }, 'result visible at origin');
  assert.equal(visible.status, 'delivered');
  const projectedRun = await call(baseA, `/v1/runs/${encodeURIComponent(chat.body.runIds[0])}`, { headers: petHeaders });
  assert.equal(projectedRun.status, 200);
  assert.equal(projectedRun.body.status, 'completed');
  if (workPanelOutage) {
    const failedWriteBack = await eventually(async () => {
      const trace = await call(baseA, `/v1/ops/traces/${chat.body.traceId}`, { headers: { authorization: 'Bearer ops-a' } });
      return trace.body.audit?.find((item) => item.event_type === 'federation.workpanel_writeback' && item.outcome === 'failed');
    }, 'independent WorkPanel write-back failure audit');
    assert.equal(failedWriteBack.correlation_id, chat.body.runIds[0]);
    const originDetail = await call(baseA, '/v1/ops/health/detail', { headers: { authorization: 'Bearer ops-a' } });
    assert.ok(originDetail.body.metrics.wpWriteBackFailures >= 1);
    wpChild = start(path.resolve('mock/workpanel-server.js'), { PORT: String(ports.wp), GROUP_ID: localBGroupId, GROUP_NAME: 'Site B local', GATE_GROUP_ID: groupId, GATE_GROUP_NAME: 'Federation', COORDINATOR_NAME: 'DeepSeek' });
    await eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${ports.wp}/api/debug/last-messages-post`);
      return response.ok;
    }, 'WorkPanel restart');
  } else {
    const wpWriteBack = await eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${ports.wp}/api/debug/last-messages-post`);
      const body = await response.json();
      return body.body?.content === 'federated pong' && body.body;
    }, 'origin WorkPanel result write-back');
    assert.equal(wpWriteBack.groupId, groupId);
  }

  const lateTerminal = signFederationEnvelope(createFederationEnvelope({
    originSite: 'site-b', targetSite: 'site-a', groupRef: ref,
    fromSubject: stableSubjectId({ siteId: 'site-b', kind: 'agent', localId: 'runner-b' }),
    toSubject: stableSubjectId({ siteId: 'site-a', kind: 'workpet', localId: 'pet-a' }),
    kind: 'run.event', correlationId: chat.body.runIds[0], causationId: randomUUID(), traceId: chat.body.traceId,
    payload: { taskId: task.taskId, originalMessageId: messageId, status: 'failed', content: 'late conflicting failure' },
  }), { keyId: 'sign-b', secret: process.env.CONNECTER_TEST_SIGN_B });
  const lateAccepted = await call(`http://127.0.0.1:${ports.host}`, '/v1/federation/messages', {
    method: 'POST', headers: { authorization: 'Bearer token-b', 'content-type': 'application/json' }, body: JSON.stringify(lateTerminal),
  });
  assert.equal(lateAccepted.status, 202, JSON.stringify(lateAccepted.body));
  await eventually(async () => {
    const trace = await call(baseA, `/v1/ops/traces/${chat.body.traceId}`, { headers: { authorization: 'Bearer ops-a' } });
    return trace.body.audit?.some((item) => item.event_type === 'federation.terminal_conflict');
  }, 'out-of-order terminal conflict audit');
  const afterConflict = await call(baseA, `/v1/messages?since=0&group=${encodeURIComponent(groupId)}`, { headers: petHeaders });
  assert.equal(afterConflict.body.messages.some((item) => item.envelope?.payload?.content === 'late conflicting failure'), false);
  const originTrace = await call(baseA, `/v1/ops/traces/${chat.body.traceId}`, { headers: { authorization: 'Bearer ops-a' } });
  assert.equal(originTrace.body.routes.length, 1);
  assert.ok(originTrace.body.telemetry.some((item) => item.event_name === 'federation.site.enqueue'));
  const hostTrace = await call(`http://127.0.0.1:${ports.host}`, `/v1/ops/traces/${chat.body.traceId}`, { headers: { authorization: 'Bearer ops-host' } });
  assert.ok(hostTrace.body.audit.some((item) => item.event_type === 'federation.accept'));
  const detail = await call(`http://127.0.0.1:${ports.host}`, '/v1/ops/health/detail', { headers: { authorization: 'Bearer ops-host' } });
  assert.equal(detail.status, 200);
  assert.equal(typeof detail.body.metrics.federationQueueDepth, 'number');
  assert.equal(typeof detail.body.metrics.federationDeliveryLatencyMs.average, 'number');
  const affected = await call(`http://127.0.0.1:${ports.host}`, '/v1/ops/security/deliveries?keyId=sign-a&siteId=site-a&limit=1', {
    headers: { authorization: 'Bearer ops-host' },
  });
  assert.ok(affected.body.deliveries.some((item) => item.originSite === 'site-a' && item.keyId === 'sign-a'));
  await eventually(async () => {
    const [healthA, healthB, hostDetail] = await Promise.all([
      call(baseA, '/health'), call(baseB, '/health'),
      call(`http://127.0.0.1:${ports.host}`, '/v1/ops/health/detail', { headers: { authorization: 'Bearer ops-host' } }),
    ]);
    return healthA.body.host?.federation?.outboxBacklog === 0 && healthA.body.host?.federation?.inboxBacklog === 0 &&
      healthB.body.host?.federation?.outboxBacklog === 0 && healthB.body.host?.federation?.inboxBacklog === 0 &&
      hostDetail.body.metrics?.federationQueueDepth === 0;
  }, 'all federation backlogs drain');
  console.log(workPanelOutage ? 'FEDERATION_WORKPANEL_OUTAGE_E2E_OK' : targetRestart ? 'FEDERATION_TARGET_RESTART_E2E_OK' : hostRestart ? 'FEDERATION_HOST_RESTART_E2E_OK' : originRestart ? 'FEDERATION_ORIGIN_RESTART_E2E_OK' : hostDataLoss ? 'FEDERATION_HOST_DATA_LOSS_E2E_OK' : chaos ? 'FEDERATION_CHAOS_E2E_OK' : 'FEDERATION_E2E_OK');
} catch (error) {
  if (hostDataLoss) {
    for (const [name, file, sql] of [
      ['site-a-outbox', path.join(root, 'a.db'), `SELECT status,attempt,available_at,last_error FROM federation_outbox`],
      ['host-messages', path.join(root, 'host.db'), `SELECT origin_site,message_id,state FROM federation_messages`],
      ['host-deliveries', path.join(root, 'host.db'), `SELECT target_site,status,attempt,last_error FROM federation_deliveries`],
    ]) {
      try { const diagnostic = new DatabaseSync(file, { readOnly: true }); process.stderr.write(`${name}=${JSON.stringify(diagnostic.prepare(sql).all())}\n`); diagnostic.close(); } catch {}
    }
  }
  for (const child of children) if (child.output) process.stderr.write(child.output);
  throw error;
} finally {
  const exits = children.map((child) => child.exitCode == null && child.signalCode == null
    ? new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGKILL'); })
    : Promise.resolve());
  await Promise.all(exits);
  fs.rmSync(root, { recursive: true, force: true });
}
