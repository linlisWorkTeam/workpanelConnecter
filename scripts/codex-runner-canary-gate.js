#!/usr/bin/env node
/** Real canary gate: local Codex Runner -> local Connecter -> ECS WorkPanel message. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';
import { wpGetGroup, wpListGroupMessages } from '../src/workpanelClient.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackedStatus() {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr}`);
  return result.stdout;
}

async function main() {
  const configPath = process.env.CONNECTER_RELAY_CONFIG || path.join(ROOT, 'config', 'relay.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const runner = (config.runners || []).find((item) => item.agentType === 'codex');
  const binding = runner?.bindings?.[0];
  if (!runner || !binding) throw new Error('Codex Runner binding is not provisioned');
  const backend = config.backends?.[binding.env];
  if (!backend || !/:8081\b/.test(backend.baseUrl) || /:8080\b/.test(backend.baseUrl)) {
    throw new Error('REFUSE: real Codex gate is restricted to WorkPanel canary :8081');
  }
  const pet = (config.pets || []).find((item) =>
    (item.groups || []).some((group) => group.env === binding.env && group.groupId === binding.groupId)
  );
  if (!pet?.token) throw new Error('matching WorkPet token is not provisioned');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nonce = `DEVICE_CODEX_ECS_CANARY_OK_${randomUUID().slice(0, 8)}`;
  const expected = `${nonce}|${packageJson.name}|${packageJson.version}`;
  const prompt = `只读打开当前工作区 package.json，核对 name 和 version。不要修改文件，不要联网，不要调用其他 Agent。只回复这一行，不加代码块或解释：${expected}`;
  const messageId = `codex_canary_${randomUUID()}`;
  const before = trackedStatus();
  const relayUrl = `http://127.0.0.1:${config.listen?.port || 9080}`;
  const chat = await fetch(`${relayUrl}/v1/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pet.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: messageId,
      env: binding.env,
      group: binding.groupName || binding.groupId,
      prompt: `@${binding.agentName}\n${prompt}`,
      petName: pet.name || pet.id,
    }),
  });
  const accepted = await chat.json().catch(() => ({}));
  if (!chat.ok || accepted.runner?.agentId !== runner.agentId) {
    throw new Error(`chat was not routed to Codex Runner: HTTP ${chat.status} ${JSON.stringify(accepted)}`);
  }
  const deadline = Date.now() + 10 * 60 * 1000;
  let run = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${relayUrl}/v1/runs/${encodeURIComponent(messageId)}`, {
      headers: { authorization: `Bearer ${pet.token}` },
    });
    if (response.ok) {
      run = await response.json();
      if (['completed', 'failed', 'cancelled', 'dead'].includes(run.status)) break;
    }
    await sleep(1000);
  }
  if (run?.status !== 'completed') throw new Error(`Codex task did not complete: ${run?.status || 'timeout'}`);

  const server = { kind: 'workpanel', baseUrl: backend.baseUrl, auth: backend.auth };
  const group = await wpGetGroup(server, binding.groupId);
  if (!group.ok) throw new Error(`WorkPanel group lookup failed: ${group.error || group.status}`);
  const member = (group.members || []).find((item) => item.kind === 'agent' && item.displayName === binding.agentName);
  if (!member) throw new Error(`WorkPanel Agent member not found: ${binding.agentName}`);
  let remoteMessage = null;
  const writeBackDeadline = Date.now() + 30000;
  while (Date.now() < writeBackDeadline && !remoteMessage) {
    const page = await wpListGroupMessages(server, binding.groupId, { limit: 100 });
    remoteMessage = (page.messages || []).find((item) =>
      (item.senderMemberId || item.sender_member_id) === member.id && String(item.content || '').trim() === expected
    );
    if (!remoteMessage) await sleep(1000);
  }
  if (!remoteMessage) throw new Error('completed Codex result was not written back to ECS WorkPanel');
  const after = trackedStatus();
  if (after !== before) throw new Error('tracked worktree changed during the read-only canary gate');
  console.log(JSON.stringify({
    ok: true,
    proof: expected,
    local: { relayUrl, agentId: runner.agentId, taskId: messageId, status: run.status },
    ecsCanary: { baseUrl: backend.baseUrl, groupId: binding.groupId, memberId: member.id, messageId: remoteMessage.id },
    worktreeUnchanged: true,
    credentials: 'not printed',
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
