#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  parseAgentMention,
  applyPetStamp,
  stripPetStamp,
} from '../src/relay/petStamp.js';
import {
  wpListGroups,
  wpGetGroup,
  wpListGroupMessages,
  wpGetPresence,
  dispatchWorkPanel,
  wpDispatchLoginTimeout,
} from '../src/workpanelClient.js';
import { createHandlers } from '../src/relay/handlers.js';
import { coordinatorAgentName, resolveChatTarget } from '../src/relay/groupConsole.js';
import { bootstrapRelay, closeDb } from '../src/relay/server.js';

const members = [
  { id: 'u1', kind: 'user', displayName: '林', isActive: true },
  { id: 'a1', kind: 'agent', displayName: 'Cursor Agent', isActive: true },
  { id: 'a2', kind: 'agent', displayName: 'Cursor', isActive: true },
];

assert.equal(wpDispatchLoginTimeout(), 15000);
assert.equal(wpDispatchLoginTimeout(8000), 8000);
assert.equal(wpDispatchLoginTimeout(30000), 15000);

{
  const hit = parseAgentMention('@Cursor Agent 修一下', members);
  assert.equal(hit.ok, true);
  assert.equal(hit.agent.id, 'a1');
  assert.equal(hit.rest, '修一下');
}

{
  const miss = parseAgentMention('@林 你好', members);
  assert.equal(miss.ok, false);
  assert.equal(miss.code, 'UNKNOWN_MENTION');
}

{
  const none = parseAgentMention('只是一句', members);
  assert.equal(none.ok, true);
  assert.equal(none.agent, null);
  assert.equal(none.rest, '只是一句');
}

{
  const caret = parseAgentMention('修一下@Cursor Agent ', members);
  assert.equal(caret.ok, true);
  assert.equal(caret.agent.id, 'a1');
  assert.equal(caret.rest, '修一下');
}

{
  const mid = parseAgentMention('修一下@Cursor Agent', members);
  assert.equal(mid.ok, true);
  assert.equal(mid.agent.id, 'a1');
  assert.equal(mid.rest, '修一下');
}

{
  const stamped = applyPetStamp('修一下', '林的Pet');
  assert.match(stamped, /【WorkPet:林的Pet】/);
  const stripped = stripPetStamp(stamped);
  assert.equal(stripped.petDisplayName, '林的Pet');
  assert.equal(stripped.contentDisplay, '修一下');
}

{
  const group = { adminMemberId: 'a1' };
  const hit = resolveChatTarget({
    prompt: '@Cursor Agent 修一下',
    members,
    group,
  });
  assert.equal(hit.ok, true);
  assert.equal(hit.agent.id, 'a1');
  assert.equal(hit.rest, '修一下');
  assert.equal(hit.mentioned, true);
}

{
  const miss = resolveChatTarget({
    prompt: '@不存在的人 你好',
    members,
    group: { adminMemberId: 'a1' },
  });
  assert.equal(miss.ok, false);
  assert.equal(miss.code, 'UNKNOWN_MENTION');
}

{
  const fallback = resolveChatTarget({
    prompt: '只是一句',
    members,
    group: { adminMemberId: 'a1' },
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.agent.displayName, 'Cursor Agent');
  assert.equal(fallback.rest, '只是一句');
  assert.equal(fallback.mentioned, false);
}

{
  const requestedIgnored = resolveChatTarget({
    prompt: '只是一句',
    members,
    group: { adminMemberId: 'a1' },
    requestedAgent: 'Cursor',
  });
  assert.equal(requestedIgnored.ok, true);
  assert.equal(requestedIgnored.agent.displayName, 'Cursor Agent');
}

{
  const none = resolveChatTarget({
    prompt: '只是一句',
    members: [{ id: 'u1', kind: 'user', displayName: '林', isActive: true }],
    group: {},
  });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'NO_ADMIN');
}

{
  const inactiveAdmin = [
    { id: 'a1', kind: 'agent', displayName: 'Cursor Agent', isActive: false },
    { id: 'a2', kind: 'agent', displayName: 'Cursor', isActive: true },
  ];
  assert.equal(
    coordinatorAgentName(inactiveAdmin, { coordinatorAgentName: 'Cursor Agent' }),
    'Cursor'
  );
  const chat = resolveChatTarget({
    prompt: '只是一句',
    members: inactiveAdmin,
    group: { adminMemberId: 'a1' },
  });
  assert.equal(chat.ok, false);
  assert.equal(chat.code, 'NO_ADMIN');
}

console.log('GROUP_CONSOLE_UNIT_OK parsers');

async function withMock(fn) {
  const child = spawn(process.execPath, ['mock/workpanel-server.js'], {
    env: { ...process.env, PORT: '18081' },
    stdio: 'ignore',
  });
  await sleep(300);
  try {
    await fn('http://127.0.0.1:18081');
  } finally {
    child.kill();
  }
}

await withMock(async (base) => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'root' }),
  });
  const { token } = await login.json();
  const headers = { authorization: `Bearer ${token}` };
  const presence = await fetch(`${base}/api/presence`, { headers });
  assert.equal(presence.status, 200);
  const p = await presence.json();
  assert.equal(Array.isArray(p.onlineUserIds), true);

  const msgs = await fetch(`${base}/api/groups/local-group-1/messages`, { headers });
  assert.equal(msgs.status, 200);
  const body = await msgs.json();
  assert.equal(Array.isArray(body.messages), true);
});

console.log('GROUP_CONSOLE_UNIT_OK mock presence+messages');

await withMock(async (base) => {
  const server = { baseUrl: base, auth: { username: 'root', password: 'root' } };
  const groups = await wpListGroups(server);
  assert.equal(groups.ok, true);
  assert.ok(groups.groups.length >= 1);
  const presence = await wpGetPresence(server);
  assert.equal(presence.ok, true);
  assert.ok(presence.onlineUserIds.includes('user-local'));

  const group = await wpGetGroup(server, 'local-group-1');
  assert.equal(group.ok, true);
  assert.equal(group.group.id, 'local-group-1');
  assert.ok(group.members.length >= 1);

  const messages = await wpListGroupMessages(server, 'local-group-1', { limit: 20 });
  assert.equal(messages.ok, true);
  assert.ok(messages.messages.length >= 1);

  const missingMsgs = await wpListGroupMessages(server, 'no-such-group');
  assert.equal(missingMsgs.ok, false);
  assert.equal(missingMsgs.status, 404);

  const team = {
    id: 'local-group-1',
    name: 'local-canary',
    coordinatorAgentName: 'Cursor Agent',
  };
  const stamped = await dispatchWorkPanel(server, team, '修一下', { petName: '林的Pet' });
  assert.equal(stamped.ok, true);
  assert.equal(stamped.status, 'accepted');
  assert.equal(stamped.body.mentionedAgent, 'Cursor Agent');

  const legacy = await dispatchWorkPanel(server, team, 'legacy prompt');
  assert.equal(legacy.ok, true);
  assert.equal(legacy.body.coordinatorAgent, 'Cursor Agent');
  assert.equal(legacy.body.mentionedAgent, 'Cursor Agent');

  const formattedContent = '@Cursor Agent\n【WorkPet:林的Pet】\n修一下';
  const skipWrap = await dispatchWorkPanel(server, team, 'ignored prompt', {
    formattedContent,
    petName: '林的Pet',
    mentionAgentName: 'Cursor Agent',
  });
  assert.equal(skipWrap.ok, true);
  assert.equal(skipWrap.status, 'accepted');
  const lastPost = await fetch(`${base}/api/debug/last-messages-post`);
  assert.equal(lastPost.status, 200);
  const lastBody = await lastPost.json();
  assert.equal(lastBody.body.content, formattedContent);
});

console.log('GROUP_CONSOLE_UNIT_OK client groups+presence+dispatch');

const handlers = createHandlers({
  config: {
    allowProdFromPet: false,
    defaults: { env: 'canary', coordinatorAgentName: 'Cursor Agent' },
    backends: {
      canary: {
        baseUrl: 'http://127.0.0.1:18081',
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
  },
});

await withMock(async () => {
  const auth = { kind: 'pet', petId: 'pet-dev-1' };
  const list = await handlers.groups(auth, { env: 'canary' });
  assert.equal(list.status, 200);
  assert.ok(list.body.groups.length >= 1);
  const one = await handlers.group(auth, list.body.groups[0].id, { env: 'canary' });
  assert.equal(one.status, 200);
  assert.equal(typeof one.body.members[0].online, 'boolean');

  const listed = await handlers.groupMessages(auth, 'local-group-1', { env: 'canary', limit: '50' });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.messages[0].contentDisplay, 'hello from group');
  assert.equal(listed.body.messages[0].petDisplayName, null);
  assert.equal(listed.body.messages[1].petDisplayName, '林的Pet');

  const missing = await handlers.groupMessages(auth, 'no-such-group', { env: 'canary' });
  assert.equal(missing.status, 404);
});

const ops = await createHandlers({ config: { backends: { canary: { baseUrl: 'http://127.0.0.1:18081' } } } })
  .groups({ kind: 'ops' }, {});
assert.equal(ops.status, 403);

await withMock(async () => {
  const bad = await handlers.chat(
    { prompt: '@不存在的人 你好', group: 'local-group-1', petName: '林的Pet' },
    { kind: 'pet', petId: 'pet-dev-1' }
  );
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'UNKNOWN_MENTION');
});

console.log('GROUP_CONSOLE_UNIT_OK handlers groups+presence+messages');

await withMock(async (base) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-chat-'));
  const dbPath = path.join(tmp, 'connector.db');
  const config = {
    allowProdFromPet: false,
    defaults: { env: 'canary', coordinatorAgentName: 'Cursor Agent' },
    backends: {
      canary: {
        baseUrl: base,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
    pets: [{ id: 'pet-dev-1', name: '林的Pet', token: 't', groups: [] }],
  };
  await bootstrapRelay({ config, dbPath, resume: false });
  try {
    const h = createHandlers({ config });
    const ok = await h.chat(
      { prompt: '@Cursor Agent 修一下', group: 'local-group-1', petName: '林的Pet' },
      { kind: 'pet', petId: 'pet-dev-1' }
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.mentionedAgent, 'Cursor Agent');

    const unbound = await h.chat(
      { prompt: '只是一句', group: 'local-group-1', petName: '林的Pet' },
      { kind: 'pet', petId: 'pet-dev-1' }
    );
    assert.equal(unbound.status, 200);
    assert.equal(unbound.body.mentionedAgent, null);
    assert.equal(unbound.body.coordinatorAgent, 'Cursor Agent');
  } finally {
    closeDb();
  }
});

console.log('GROUP_CONSOLE_UNIT_OK handlers chat @mention+stamp');
