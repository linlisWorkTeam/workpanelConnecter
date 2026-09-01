#!/usr/bin/env node
/** Safely provision this Windows Codex Runner in the ignored local relay config. */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from '../src/config.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sameBinding(binding, env, groupId, agentName) {
  return binding?.env === env && String(binding?.groupId || binding?.group || binding?.id) === groupId && binding?.agentName === agentName;
}

function main() {
  const configPath = path.resolve(arg('--config', path.join(ROOT, 'config', 'relay.json')));
  const workspace = path.resolve(arg('--workspace', ROOT));
  const targetUrl = String(arg('--url', process.env.CONNECTER_CANARY_URL || '')).replace(/\/+$/, '');
  const env = arg('--env', 'ecs-canary');
  const groupId = arg('--group-id', process.env.CONNECTER_CODEX_GROUP_ID);
  const groupName = arg('--group-name', 'ohMyWorkPanel');
  const agentName = arg('--agent-name', 'Codex-Windows11');
  const agentId = arg('--agent-id', 'codex-windows11');
  const databasePath = arg('--db', path.join('data', 'codex-runner-canary.db'));
  if (!groupId) throw new Error('--group-id or CONNECTER_CODEX_GROUP_ID is required');
  if (!/:8081\b/.test(targetUrl) || /:8080\b/.test(targetUrl)) {
    throw new Error('REFUSE: Codex Runner provisioning is restricted to WorkPanel canary :8081');
  }
  if (!fs.statSync(workspace).isDirectory()) throw new Error(`workspace is not a directory: ${workspace}`);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.db = { ...(config.db || {}), path: databasePath };
  const authSource = Object.values(config.backends || {}).find(
    (backend) => backend?.kind === 'workpanel' && backend?.auth?.username && backend?.auth?.password
  );
  if (!authSource) throw new Error('no existing WorkPanel auth is available in the ignored relay config');
  config.backends ||= {};
  config.backends[env] = {
    ...(config.backends[env] || {}),
    label: 'ECS canary',
    baseUrl: targetUrl,
    kind: 'workpanel',
    auth: { ...authSource.auth },
  };

  const binding = { env, groupId, groupName, agentName, workspace };
  config.runners ||= [];
  let runner = config.runners.find((item) => item.agentId === agentId);
  if (!runner) {
    runner = { agentId, token: `codex_runner_${randomBytes(32).toString('base64url')}` };
    config.runners.push(runner);
  }
  runner.displayName = agentName;
  runner.agentType = 'codex';
  runner.role = 'general';
  runner.runtime = 'windows-local';
  runner.protocolVersion = 2;
  runner.maxConcurrency = 1;
  runner.heartbeatMs = 15000;
  runner.labels = { ...(runner.labels || {}), execution: 'local', platform: 'win32', device: 'Windows11' };
  runner.capabilities = [{ name: 'code.execute', version: '1' }];
  runner.bindings ||= [];
  const existingBinding = runner.bindings.find((item) => sameBinding(item, env, groupId, agentName));
  if (existingBinding) Object.assign(existingBinding, binding);
  else runner.bindings.push(binding);
  runner.codex = {
    ...(runner.codex || {}),
    workspace,
    sandbox: 'workspace-write',
    sessionMode: 'ephemeral',
    timeoutMs: 15 * 60 * 1000,
    requestTimeoutMs: 10000,
  };

  const pet = (config.pets || [])[0];
  if (!pet) throw new Error('at least one provisioned WorkPet is required for the local canary gate');
  pet.groups ||= [];
  const petBinding = pet.groups.find((item) => sameBinding(item, env, groupId, agentName));
  if (petBinding) Object.assign(petBinding, binding);
  else pet.groups.push(binding);

  const backupDir = path.resolve(arg('--backup-dir', path.join(ROOT, 'tmp')));
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `relay-before-codex-${stamp}.json`);
  fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  const temporary = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, configPath);

  console.log(JSON.stringify({
    ok: true,
    configPath,
    backupPath,
    target: { env, url: targetUrl, groupId, groupName, agentName, agentId, workspace, databasePath },
    credentials: 'preserved locally and not printed',
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
