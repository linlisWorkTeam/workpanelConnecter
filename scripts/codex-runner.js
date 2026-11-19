#!/usr/bin/env node
/** Outbound-only WorkPanelConnecter Runner for the Codex CLI. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { resolveCodexExecutable } from '../src/runners/codexCliAdapter.js';
import { createCodexExecutor } from '../src/runners/codexExecutor.js';
import { createRunnerClient } from '../src/runners/runnerClient.js';
import { runRunner } from '../src/runners/runnerLoop.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
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
  const client = createRunnerClient({
    relayUrl: runtime.relayUrl, token: runtime.token,
    requestTimeoutMs: Number(runtime.codex.requestTimeoutMs || 10000),
  });
  await runRunner({
    name: 'codex-runner', client,
    heartbeatMs: Number(runtime.provisioned?.heartbeatMs || 15000),
    once: has('--once'),
    registration: {
      agentId: runtime.agentId,
      displayName: runtime.provisioned?.displayName || runtime.agentId,
      agentType: 'codex', runtime: runtime.provisioned?.runtime || 'windows-local',
      protocolVersion: 2, maxConcurrency: 1,
      labels: runtime.provisioned?.labels || { execution: 'local', platform: process.platform },
      capabilities: runtime.provisioned?.capabilities || [{ name: 'code.execute', version: '1' }],
      groups: runtime.bindings,
    },
    execute: createCodexExecutor(runtime),
  });
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});

