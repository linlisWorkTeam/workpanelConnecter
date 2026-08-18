#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  parseAgentMention,
  applyPetStamp,
  stripPetStamp,
} from '../src/relay/petStamp.js';

const members = [
  { id: 'u1', kind: 'user', displayName: '林', isActive: true },
  { id: 'a1', kind: 'agent', displayName: 'Cursor Agent', isActive: true },
  { id: 'a2', kind: 'agent', displayName: 'Cursor', isActive: true },
];

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
  const stamped = applyPetStamp('修一下', '林的Pet');
  assert.match(stamped, /【WorkPet:林的Pet】/);
  const stripped = stripPetStamp(stamped);
  assert.equal(stripped.petDisplayName, '林的Pet');
  assert.equal(stripped.contentDisplay, '修一下');
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
