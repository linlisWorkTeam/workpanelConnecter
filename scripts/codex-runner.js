#!/usr/bin/env node
/** Outbound-only WorkPanelConnecter Runner for the Codex CLI. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/config.js';
import { resolveCodexExecutable, runCodexCli } from '../src/runners/codexCliAdapter.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadRuntime() {
  const configPath = process.env.CONNECTER_RELAY_CONFIG || arg('--config', path.join(ROOT, 'config', 'relay.json'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const agentId = process.env.CONNECTER_RUNNER_ID || arg('--agentId');
  const provisioned = (config.runners || []).find((runner) => runner.agentId === agentId) ||
    (!agentId ? (config.runners || []).find((runner) => runner.agentType === 'codex') : null);
  const id = agentId || provisioned?.agentId;
  const token = process.env.CONNECTER_RUNNER_TOKEN || provisioned?.token;
  if (!id || !token) throw new Error('Codex Runner requires a provisioned agentId and token');
  const codex = provisioned?.codex || {};
  const bindings = provisioned?.bindings || [];
  const workspaceByGroup = new Map(
    bindings.map((binding) => [String(binding.groupId || binding.group || binding.id), binding.workspace || codex.workspace])
  );
  const relayUrl = String(
    process.env.CONNECTER_RELAY_URL || arg('--relay', `http://127.0.0.1:${config.listen?.port || 9080}`)
  ).replace(/\/+$/, '');
  return {
    config,
    provisioned,
    agentId: id,
    token,
    relayUrl,
    bindings,
    workspaceByGroup,
    command: resolveCodexExecutable(process.env.CONNECTER_CODEX_COMMAND || codex.command),
    codex,
  };
}

async function request(runtime, pathname, { method = 'POST', body, runnerAuth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (runnerAuth) headers.authorization = `Bearer ${runtime.token}`;
  const response = await fetch(`${runtime.relayUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Number(runtime.codex?.requestTimeoutMs || 10000)),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

async function register(runtime) {
  const registration = await request(runtime, '/v1/agents/register', {
    runnerAuth: false,
    body: {
      agentId: runtime.agentId,
      token: runtime.token,
      displayName: runtime.provisioned?.displayName || runtime.agentId,
      agentType: 'codex',
      runtime: runtime.provisioned?.runtime || 'windows-local',
      protocolVersion: 2,
      maxConcurrency: 1,
      labels: runtime.provisioned?.labels || { execution: 'local', platform: process.platform },
      capabilities: runtime.provisioned?.capabilities || [{ name: 'code.execute', version: '1' }],
      groups: runtime.bindings,
    },
  });
  if (registration.status !== 200) {
    throw new Error(`runner register failed HTTP ${registration.status}: ${registration.body?.code || registration.body?.error || 'unknown'}`);
  }
  return registration.body;
}

function sessionFile(runtime) {
  return path.resolve(runtime.codex.sessionFile || path.join(ROOT, 'data', 'codex-runner-sessions.json'));
}

function loadSessions(runtime) {
  if ((runtime.codex.sessionMode || 'ephemeral') !== 'persistent') return {};
  try {
    return JSON.parse(fs.readFileSync(sessionFile(runtime), 'utf8'));
  } catch {
    return {};
  }
}

function saveSessions(runtime, sessions) {
  if ((runtime.codex.sessionMode || 'ephemeral') !== 'persistent') return;
  const file = sessionFile(runtime);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(sessions, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function taskSessionKey(task, workspace) {
  return `${task.env || ''}:${task.groupId}:${task.agentName}:${workspace}`;
}

async function submitResult(runtime, task, status, content, resultId) {
  return request(runtime, '/v1/agents/tasks/result', {
    body: {
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      resultId,
      status,
      content,
      writeBack: status === 'completed',
    },
  });
}

async function executeTask(runtime, task, sessions) {
  const workspace = runtime.workspaceByGroup.get(String(task.groupId)) || runtime.codex.workspace;
  const finalResultId = `result_${task.taskId}_${task.attempt || 1}_final`;
  const ack = await request(runtime, '/v1/agents/tasks/ack', {
    body: { taskId: task.taskId, leaseToken: task.leaseToken },
  });
  if (ack.status !== 200) return;
  if (!workspace || !path.isAbsolute(workspace) || !fs.existsSync(workspace)) {
    await submitResult(runtime, task, 'failed', 'Codex Runner workspace is not configured or does not exist.', finalResultId);
    return;
  }

  const controller = new AbortController();
  let leaseLost = false;
  const leaseMs = Math.max(3000, Number(task.leaseSec || 60) * 1000);
  const renewEveryMs = Math.max(1000, Math.floor(leaseMs / 3));
  let leaseExpiresAt = Date.now() + leaseMs;
  let renewing = false;
  const renewTimer = setInterval(async () => {
    if (renewing || leaseLost) return;
    renewing = true;
    try {
      const renewed = await request(runtime, '/v1/agents/tasks/renew', {
        body: { taskId: task.taskId, leaseToken: task.leaseToken },
      });
      if (renewed.status === 200) {
        leaseExpiresAt = Date.now() + leaseMs;
      } else if (renewed.status < 500) {
        leaseLost = true;
        controller.abort('stale_lease');
      }
    } catch {
      // A transient network failure does not immediately surrender a valid lease.
    } finally {
      renewing = false;
    }
  }, renewEveryMs);
  renewTimer.unref?.();
  const leaseWatchdog = setInterval(() => {
    if (!leaseLost && Date.now() >= leaseExpiresAt) {
      leaseLost = true;
      controller.abort('lease_expired_locally');
    }
  }, Math.min(1000, Math.max(100, Math.floor(renewEveryMs / 4))));
  leaseWatchdog.unref?.();

  const key = taskSessionKey(task, workspace);
  const sessionMode = runtime.codex.sessionMode || 'ephemeral';
  const priorSession = sessionMode === 'persistent' ? sessions[key] || null : null;
  let result;
  try {
    result = await runCodexCli({
      command: runtime.command,
      commandArgs: Array.isArray(runtime.codex.commandArgs) ? runtime.codex.commandArgs : [],
      workspace,
      prompt: task.prompt,
      sessionId: priorSession,
      sessionMode,
      sandbox: runtime.codex.sandbox || 'workspace-write',
      model: runtime.codex.model || null,
      profile: runtime.codex.profile || null,
      timeoutMs: Number(runtime.codex.timeoutMs || 15 * 60 * 1000),
      signal: controller.signal,
    });
  } finally {
    clearInterval(renewTimer);
    clearInterval(leaseWatchdog);
  }
  if (leaseLost) return;
  if (result.ok && sessionMode === 'persistent' && result.threadId) {
    sessions[key] = result.threadId;
    saveSessions(runtime, sessions);
  }
  const status = result.ok ? 'completed' : 'failed';
  const content = result.ok ? result.content : `Codex Runner failed: ${result.error}`;
  const submitted = await submitResult(runtime, task, status, content, finalResultId);
  if (submitted.status !== 200 && submitted.status !== 409) {
    throw new Error(`result submit failed HTTP ${submitted.status}`);
  }
}

async function check(runtime) {
  const version = await new Promise((resolve) => {
    const child = process.platform === 'win32' && /\.(cmd|bat)$/i.test(runtime.command)
      ? null
      : runtime.command;
    if (!child) return resolve({ ok: false, error: 'Codex command must resolve to an executable (.exe) on Windows' });
    import('node:child_process').then(({ spawnSync }) => {
      const output = spawnSync(child, ['--version'], { encoding: 'utf8', windowsHide: true });
      resolve({ ok: output.status === 0, version: String(output.stdout || '').trim(), error: String(output.stderr || '').trim() });
    });
  });
  console.log(JSON.stringify({
    ok: version.ok,
    command: runtime.command,
    version: version.version || null,
    relayUrl: runtime.relayUrl,
    agentId: runtime.agentId,
    groups: runtime.bindings.map((binding) => ({ groupId: binding.groupId, agentName: binding.agentName })),
  }, null, 2));
  if (!version.ok) process.exitCode = 1;
}

async function main() {
  const runtime = loadRuntime();
  if (has('--check')) return check(runtime);
  const registration = await register(runtime);
  console.log(`[codex-runner] registered agent=${runtime.agentId} channel=${registration.channelId}`);
  const sessions = loadSessions(runtime);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  const heartbeatMs = Math.max(1000, Number(runtime.provisioned?.heartbeatMs || 15000));
  const heartbeatTimer = setInterval(() => {
    request(runtime, '/v1/agents/heartbeat', { body: {} }).catch(() => {});
  }, heartbeatMs);
  heartbeatTimer.unref?.();
  await request(runtime, '/v1/agents/heartbeat', { body: {} });

  let processed = 0;
  while (!stopping) {
    const pulled = await request(runtime, '/v1/agents/tasks', { body: {} });
    if (pulled.status !== 200) throw new Error(`task poll failed HTTP ${pulled.status}`);
    for (const task of pulled.body?.tasks || []) {
      await executeTask(runtime, task, sessions);
      processed += 1;
      if (has('--once')) stopping = true;
    }
    if (!stopping) await sleep(800);
  }
  clearInterval(heartbeatTimer);
  console.log(`[codex-runner] stopped processed=${processed}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
