#!/usr/bin/env node
/**
 * E2 pluggable runner: pull tasks from Connecter and actually dispatch WorkPanel (canary).
 * Outbound only. Set writeBack=false so Connecter does not duplicate into the group.
 *
 * Env:
 *   CONNECTER_RELAY_URL     the one Connecter hub (co-located: http://127.0.0.1:9080; LAN: http://<hub>:9080)
 *   CONNECTER_RUNNER_ID     required unless --agentId
 *   CONNECTER_RUNNER_TOKEN  required unless in relay.json runners[]
 *   CONNECTER_RELAY_CONFIG  default config/relay.json
 *   CONNECTER_WP_POLL_MS    default 2000
 *   CONNECTER_WP_WAIT_MS    default 45000
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { createRunnerClient } from '../src/runners/runnerClient.js';
import { runRunner } from '../src/runners/runnerLoop.js';
import { createWorkpanelExecutor } from '../src/runners/workpanelExecutor.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const cfgPath =
    process.env.CONNECTER_RELAY_CONFIG ||
    arg('--config', path.join(ROOT, 'config', 'relay.json'));
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const agentId = process.env.CONNECTER_RUNNER_ID || arg('--agentId', config.runners?.[0]?.agentId);
  const provisioned = (config.runners || []).find((r) => r.agentId === agentId);
  const token = process.env.CONNECTER_RUNNER_TOKEN || provisioned?.token;
  const base = (process.env.CONNECTER_RELAY_URL || arg('--relay', `http://127.0.0.1:${config.listen?.port || 9080}`)).replace(
    /\/$/,
    ''
  );
  if (!agentId || !token) {
    throw new Error('CONNECTER_RUNNER_ID and CONNECTER_RUNNER_TOKEN (or runners[] in config) required');
  }
  const pollMs = Number(process.env.CONNECTER_WP_POLL_MS || 2000);
  const waitMs = Number(process.env.CONNECTER_WP_WAIT_MS || 45000);
  await runRunner({
    name: 'wp-runner',
    client: createRunnerClient({ relayUrl: base, token }),
    heartbeatMs: Number(provisioned?.heartbeatMs || 15000),
    once: process.argv.includes('--once'),
    registration: {
      agentId, agentType: provisioned?.agentType || 'workpanel',
      runtime: provisioned?.runtime || 'local', protocolVersion: 2,
      maxConcurrency: 1,
    },
    execute: createWorkpanelExecutor(config, { pollMs, waitMs }),
  });
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
