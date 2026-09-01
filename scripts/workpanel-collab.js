#!/usr/bin/env node
/**
 * Inspect or message an ohMyWorkPanel canary Agent without exposing credentials.
 *
 * Auth is reused from an ignored Relay config (default config/relay.json). The
 * target must be an explicit :8081 canary URL; production :8080 is refused.
 *
 * Examples:
 *   node scripts/workpanel-collab.js --url http://host:8081 --list
 *   node scripts/workpanel-collab.js --url http://host:8081 --group Group \
 *     --agent Agent --prompt-file tmp/request.md --wait-ms 180000
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import {
  dispatchWorkPanel,
  extractWpMessageText,
  wpGetGroup,
  wpListGroupMessages,
  wpListGroups,
  wpSession,
} from '../src/workpanelClient.js';

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

function loadServer(url) {
  const configPath = process.env.CONNECTER_RELAY_CONFIG || path.join(ROOT, 'config', 'relay.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const withAuth = Object.values(config.backends || {}).find(
    (backend) => backend?.kind === 'workpanel' && backend?.auth
  );
  if (!withAuth) throw new Error(`no WorkPanel auth found in ${configPath}`);
  return { kind: 'workpanel', baseUrl: url, auth: withAuth.auth };
}

function assertCanaryUrl(raw) {
  const url = String(raw || '').replace(/\/+$/, '');
  if (!url) throw new Error('--url or CONNECTER_CANARY_URL is required');
  if (/:8080\b/.test(url)) throw new Error('REFUSE: production :8080 is not a canary');
  if (!/:8081\b/.test(url)) throw new Error('REFUSE: collaboration target must use :8081');
  return url;
}

async function resolveGroup(server, key) {
  const listed = await wpListGroups(server);
  if (!listed.ok) throw new Error(`list groups failed: ${listed.error || listed.status}`);
  const summaries = listed.groups || [];
  if (!key) return { summaries, group: null };
  const summary = summaries.find((item) => item.id === key || item.name === key);
  if (!summary) throw new Error(`group not found: ${key}`);
  const got = await wpGetGroup(server, summary.id);
  if (!got.ok) throw new Error(`get group failed: ${got.error || got.status}`);
  return { summaries, group: { ...got.group, members: got.members || [] } };
}

async function list(server) {
  const { summaries } = await resolveGroup(server, null);
  const groups = [];
  for (const summary of summaries) {
    const got = await wpGetGroup(server, summary.id);
    groups.push({
      id: summary.id,
      name: summary.name,
      groupKind: summary.groupKind || summary.group_kind || null,
      members: got.ok
        ? (got.members || []).filter((m) => m.isActive).map((m) => ({
            id: m.id,
            kind: m.kind,
            displayName: m.displayName,
            adapter: m.adapter || null,
            runtimeStatus: m.runtimeStatus || null,
          }))
        : [],
    });
  }
  console.log(JSON.stringify({ canary: server.baseUrl, groups }, null, 2));
}

async function listAdapters(server) {
  const session = await wpSession(server);
  const response = await fetch(`${server.baseUrl}/api/adapters`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`list adapters failed: HTTP ${response.status}`);
  console.log(JSON.stringify({ canary: server.baseUrl, adapters: body }, null, 2));
}

function nonEmptyMessageText(content) {
  const text = extractWpMessageText(content).trim();
  if (!text) return '';
  try {
    const value = JSON.parse(text);
    if (value && Array.isArray(value.parts) && value.parts.length === 0) return '';
  } catch {
    // Plain text is a valid Agent reply.
  }
  return text;
}

async function history(server) {
  const groupKey = arg('--group');
  const runId = arg('--run');
  if (!groupKey) throw new Error('--group is required with --history');
  const { group } = await resolveGroup(server, groupKey);
  const page = await wpListGroupMessages(server, group.id, { limit: 30 });
  if (!page.ok) throw new Error(`list messages failed: ${page.error || page.status}`);
  const session = await wpSession(server);
  const runsResponse = await fetch(`${server.baseUrl}/api/groups/${encodeURIComponent(group.id)}/runs`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const runs = await runsResponse.json().catch(() => []);
  const allMessages = page.messages || [];
  const allRuns = Array.isArray(runs) ? runs : [];
  const selectedRun = runId ? allRuns.find((run) => run.id === runId) || null : null;
  const selectedMessages = runId
    ? allMessages.filter((message) => (message.parentRunId || message.parent_run_id) === runId)
    : allMessages;
  console.log(JSON.stringify({
    group: { id: group.id, name: group.name },
    run: runId ? selectedRun : undefined,
    messages: selectedMessages.map((message) => ({
      id: message.id,
      senderMemberId: message.senderMemberId || message.sender_member_id || null,
      parentRunId: message.parentRunId || message.parent_run_id || null,
      createdAt: message.createdAt || message.created_at || null,
      text: nonEmptyMessageText(message.content),
    })),
    runs: runId ? undefined : (Array.isArray(runs) ? runs.slice(0, 30) : runs),
  }, null, 2));
}

async function waitForReply(server, groupId, runId, startedAt, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const page = await wpListGroupMessages(server, groupId, { limit: 100 });
    if (page.ok) {
      for (const message of page.messages || []) {
        const createdAt = Number(message.createdAt || message.created_at || 0);
        const matchesRun = runId && message.parentRunId === runId;
        if (!matchesRun && (!createdAt || createdAt < startedAt)) continue;
        if (message.senderKind && message.senderKind !== 'agent') continue;
        const text = nonEmptyMessageText(message.content);
        if (!text || text.includes('【Connecter 调度】')) continue;
        return { ok: true, messageId: message.id, text };
      }
    }
    await sleep(2000);
  }
  return { ok: false, error: 'agent_reply_timeout' };
}

async function send(server) {
  const groupKey = arg('--group');
  const agentName = arg('--agent');
  const promptFile = arg('--prompt-file');
  if (!groupKey || !agentName || !promptFile) {
    throw new Error('--group, --agent, and --prompt-file are required when sending');
  }
  const promptPath = path.resolve(promptFile);
  const prompt = fs.readFileSync(promptPath, 'utf8').trim();
  if (!prompt) throw new Error(`prompt file is empty: ${promptPath}`);
  const { group } = await resolveGroup(server, groupKey);
  const agent = group.members.find(
    (member) => member.kind === 'agent' && member.isActive &&
      (member.displayName === agentName || member.id === agentName)
  );
  if (!agent) throw new Error(`active agent not found: ${agentName}`);
  const startedAt = Date.now() - 2000;
  const dispatched = await dispatchWorkPanel(
    server,
    { id: group.id, name: group.name, coordinatorAgentName: agent.displayName },
    prompt,
    { timeoutMs: 30000 }
  );
  if (!dispatched.ok) {
    throw new Error(`dispatch failed: ${dispatched.error || dispatched.status}`);
  }
  const runId = dispatched.body?.runIds?.[0] || null;
  const waitMs = Number(arg('--wait-ms', '180000'));
  const reply = await waitForReply(server, group.id, runId, startedAt, waitMs);
  console.log(JSON.stringify({
    accepted: true,
    groupId: group.id,
    groupName: group.name,
    agentName: agent.displayName,
    wpMessageId: dispatched.body?.messageId || dispatched.taskId || null,
    runId,
    reply,
  }, null, 2));
  if (!reply.ok) process.exitCode = 2;
}

async function main() {
  const url = assertCanaryUrl(arg('--url', process.env.CONNECTER_CANARY_URL));
  const server = loadServer(url);
  if (has('--list')) return list(server);
  if (has('--adapters')) return listAdapters(server);
  if (has('--history')) return history(server);
  return send(server);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
