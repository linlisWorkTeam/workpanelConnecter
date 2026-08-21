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
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/config.js';
import {
  dispatchWorkPanel,
  wpListGroupMessages,
  extractWpMessageText,
} from '../src/workpanelClient.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function backendAsServer(backend) {
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth: backend.auth || {},
  };
}

async function waitForAgentReply(server, groupId, runId, { waitMs, pollMs, afterTs }) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const page = await wpListGroupMessages(server, groupId, { limit: 40 });
    if (page.ok) {
      for (const m of page.messages || []) {
        if (runId && m.parentRunId === runId) {
          const text = extractWpMessageText(m.content);
          if (text && !text.includes('【Connecter 调度】')) return { ok: true, text, messageId: m.id };
        }
        if (!runId && afterTs && Number(m.createdAt) > afterTs) {
          const text = extractWpMessageText(m.content);
          if (text && !text.includes('【Connecter 调度】')) return { ok: true, text, messageId: m.id };
        }
      }
    }
    await sleep(pollMs);
  }
  return { ok: false, error: 'agent_reply_timeout' };
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
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const reg = await jsonFetch(`${base}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId,
      token,
      agentType: provisioned?.agentType || 'workpanel',
      runtime: provisioned?.runtime || 'local',
    }),
  });
  if (reg.status !== 200) {
    throw new Error(`register failed HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  console.log(`[wp-runner] registered ${agentId} channel=${reg.body.channelId} relay=${base}`);

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });

  while (!stopping) {
    await jsonFetch(`${base}/v1/agents/heartbeat`, { method: 'POST', headers, body: '{}' });
    const pulled = await jsonFetch(`${base}/v1/agents/tasks`, { method: 'POST', headers, body: '{}' });
    const tasks = pulled.body?.tasks || [];
    for (const task of tasks) {
      const ack = await jsonFetch(`${base}/v1/agents/tasks/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: task.taskId, leaseToken: task.leaseToken }),
      });
      if (ack.status !== 200) {
        console.warn(`[wp-runner] ack rejected task=${task.taskId} HTTP ${ack.status}`);
        continue;
      }
      const env = task.env || config.defaults?.env || 'canary';
      const backend = config.backends?.[env];
      if (!backend || /:8080\b/.test(backend.baseUrl || '')) {
        await jsonFetch(`${base}/v1/agents/tasks/result`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            taskId: task.taskId,
            leaseToken: task.leaseToken,
            resultId: `result_${randomUUID()}`,
            status: 'failed',
            content: 'refused: missing canary backend or prod :8080',
            writeBack: false,
          }),
        });
        continue;
      }
      const server = backendAsServer(backend);
      const dispatched = await dispatchWorkPanel(
        server,
        {
          id: task.groupId,
          name: task.groupId,
          coordinatorAgentName: task.agentName,
        },
        task.prompt
      );
      const wpMessageId = dispatched.body?.messageId || dispatched.taskId;
      const runId = dispatched.body?.runIds?.[0] || null;
      await jsonFetch(`${base}/v1/agents/tasks/result`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          taskId: task.taskId,
          leaseToken: task.leaseToken,
          resultId: `result_${randomUUID()}`,
          status: 'running',
          content: dispatched.ok
            ? `wp_accepted messageId=${wpMessageId || ''} runId=${runId || ''}`
            : `wp_dispatch_failed ${dispatched.error || ''}`,
          writeBack: false,
        }),
      });
      if (!dispatched.ok) {
        await jsonFetch(`${base}/v1/agents/tasks/result`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            taskId: task.taskId,
            leaseToken: task.leaseToken,
            resultId: `result_${randomUUID()}`,
            status: 'failed',
            content: dispatched.error || 'wp dispatch failed',
            writeBack: false,
          }),
        });
        continue;
      }
      const reply = await waitForAgentReply(server, task.groupId, runId, {
        waitMs,
        pollMs,
        afterTs: Date.now() - 5000,
      });
      await jsonFetch(`${base}/v1/agents/tasks/renew`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: task.taskId, leaseToken: task.leaseToken }),
      });
      await jsonFetch(`${base}/v1/agents/tasks/result`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          taskId: task.taskId,
          leaseToken: task.leaseToken,
          resultId: `result_${randomUUID()}`,
          status: reply.ok ? 'completed' : 'failed',
          content: reply.ok ? reply.text : `timeout waiting WP agent reply (wpMessageId=${wpMessageId})`,
          writeBack: false,
        }),
      });
    }
    await sleep(800);
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
