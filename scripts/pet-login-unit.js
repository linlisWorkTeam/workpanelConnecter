#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHandlers } from '../src/relay/handlers.js';
import { bootstrapRelay, closeDb, createRelayServer } from '../src/relay/server.js';
import { clearSessionWpAuth } from '../src/relay/sessionWpAuth.js';

async function withMock(fn) {
  const child = spawn(process.execPath, ['mock/workpanel-server.js'], {
    env: { ...process.env, PORT: '18082' },
    stdio: 'ignore',
  });
  await sleep(300);
  try {
    await fn('http://127.0.0.1:18082');
  } finally {
    child.kill();
  }
}

function testConfig(base) {
  return {
    allowProdFromPet: false,
    defaults: { env: 'canary', coordinatorAgentName: 'Cursor Agent' },
    backends: {
      canary: {
        baseUrl: base,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
    pets: [
      {
        id: 'pet-dev-1',
        name: '林的Pet',
        token: 'pet-dev-token',
        wpAuth: { username: 'root', password: 'root' },
        groups: [],
      },
    ],
  };
}

await withMock(async (base) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-login-'));
  const dbPath = path.join(tmp, 'connector.db');
  const config = testConfig(base);
  await bootstrapRelay({ config, dbPath, resume: false });
  clearSessionWpAuth();
  try {
    const h = createHandlers({ config });
    const missing = await h.login({});
    assert.equal(missing.status, 400);

    const bad = await h.login({ username: 'root', password: 'wrong', env: 'canary' });
    assert.equal(bad.status, 401);

    const ok = await h.login({ username: 'root', password: 'root', env: 'canary' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.petId, 'pet-dev-1');
    assert.equal(ok.body.token, 'pet-dev-token');
    assert.ok(ok.body.userId);

    const auth = { kind: 'pet', petId: ok.body.petId };
    const list = await h.groups(auth, { env: 'canary' });
    assert.equal(list.status, 200);
    const ids = (list.body.groups || []).map((g) => g.id);
    assert.ok(ids.includes('local-group-1'));
    assert.equal(ids.includes('outsider-group-1'), false);

    const denied = await h.group(auth, 'outsider-group-1', { env: 'canary' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'NOT_IN_GROUP');

    const deniedMsgs = await h.groupMessages(auth, 'outsider-group-1', { env: 'canary' });
    assert.equal(deniedMsgs.status, 403);
    assert.equal(deniedMsgs.body.code, 'NOT_IN_GROUP');

    const deniedChat = await h.chat(
      { prompt: '@Cursor Agent 修一下', group: 'outsider-group-1', petName: '林的Pet' },
      auth
    );
    assert.equal(deniedChat.status, 403);
    assert.equal(deniedChat.body.code, 'NOT_IN_GROUP');

    const guest = await h.login({ username: 'guest', password: 'guest', env: 'canary' });
    assert.equal(guest.status, 200);
    assert.notEqual(guest.body.petId, 'pet-dev-1');
    assert.ok(guest.body.token);

    const { server } = createRelayServer({ config, configPath: '(inline)' });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const { port } = server.address();
      const httpLogin = await fetch(`http://127.0.0.1:${port}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'root', password: 'root', env: 'canary' }),
      });
      const httpBody = await httpLogin.json();
      assert.notEqual(httpBody.error, 'missing bearer token');
      assert.equal(httpLogin.status, 200);
      assert.equal(httpBody.token, 'pet-dev-token');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    clearSessionWpAuth();
    closeDb();
  }
});

console.log('PET_LOGIN_UNIT_OK');
