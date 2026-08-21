#!/usr/bin/env node
/**
 * E2 live acceptance: @ vs no-@ against real canary WP :8081.
 * Does NOT use relay.example.json and does NOT start wp-runner.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { listenRelay, closeDb } from '../src/relay/server.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const PORT = Number(process.env.CONNECTER_E2_PORT || 9098);
  const PET_TOKEN = 'e2-pet-token';
  const GROUP_ID = process.env.CONNECTER_CANARY_GROUP_ID || '528b36ba-4769-4b4d-9fa8-51e2de132396';
  const GROUP_NAME = process.env.CONNECTER_CANARY_GROUP_NAME || '灰度测试';
  const canaryUrl = String(process.env.CONNECTER_CANARY_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
  assert(!/:8080\b/.test(canaryUrl), 'REFUSE prod :8080');
  const health = await fetch(`${canaryUrl}/api/health`).catch(() => null);
  assert(health && health.ok, `canary ${canaryUrl} must be up`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-e2-'));
  const cfgPath = path.join(tmp, 'relay.json');
  const dbPath = path.join(tmp, 'connector.db');
  const config = {
    listen: { host: '127.0.0.1', port: PORT },
    db: { path: dbPath },
    auth: { tokens: ['e2-ops'] },
    allowProdFromPet: false,
    backends: {
      canary: {
        baseUrl: canaryUrl,
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
    defaults: { env: 'canary', group: GROUP_NAME },
    runners: [],
    pets: [
      {
        id: 'pet-e2',
        name: 'E2 Pet',
        token: PET_TOKEN,
        groups: [{ env: 'canary', groupId: GROUP_ID, groupName: GROUP_NAME }],
      },
    ],
  };
  assert(!/:8080\b/.test(JSON.stringify(config)), 'REFUSE prod :8080');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

  process.env.CONNECTER_RELAY_PORT = String(PORT);
  process.env.CONNECTER_RELAY_HOST = '127.0.0.1';
  const { server } = await listenRelay({ configPath: cfgPath, dbPath, resume: false });
  const base = `http://127.0.0.1:${PORT}`;
  const petHeaders = { authorization: `Bearer ${PET_TOKEN}`, 'content-type': 'application/json' };

  try {
    const members = await jsonFetch(`${base}/v1/members?group=${encodeURIComponent(GROUP_NAME)}`, {
      headers: { authorization: `Bearer ${PET_TOKEN}` },
    });
    assert(members.status === 200, `members ${members.status}`);
    assert(members.body.selfMemberId, 'pet must resolve a self member (wp user or unlinked owner fallback)');
    const selfRow = (members.body.members || []).find((m) => m.id === members.body.selfMemberId);
    assert(selfRow && selfRow.self === true && selfRow.online === true, 'self member must be marked self+online');
    const adminName = members.body.adminAgent?.displayName;
    assert(adminName, 'canary group must have an admin agent (NO_ADMIN otherwise)');
    const otherAgent = (members.body.members || []).find(
      (m) => m.kind === 'agent' && m.displayName !== adminName && m.isActive
    );

    const unknown = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({
        id: `msg_e2_bad_${randomUUID()}`,
        group: GROUP_NAME,
        prompt: '@NotAnAgent_zzz 不该发出',
      }),
    });
    assert(unknown.status === 400 && unknown.body.code === 'UNKNOWN_MENTION', 'bad @ → UNKNOWN_MENTION');

    const noAt = await jsonFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: petHeaders,
      body: JSON.stringify({
        id: `msg_e2_noat_${randomUUID()}`,
        group: GROUP_NAME,
        prompt: `E2 无@验收 ${new Date().toISOString()} — 请仅确认收到，勿深层委派。`,
      }),
    });
    assert(noAt.status === 200 && noAt.body.status === 'accepted', `no-@ chat ${noAt.status} ${JSON.stringify(noAt.body)}`);
    assert(noAt.body.coordinatorAgent === adminName, `no-@ must go to admin (${adminName}), got ${noAt.body.coordinatorAgent}`);
    assert(!noAt.body.mentionedAgent, 'no-@ must not set mentionedAgent');
    assert(!noAt.body.runner, 'no-@ must not use runner (example bindings are not the product path)');

    if (otherAgent) {
      const at = await jsonFetch(`${base}/v1/chat`, {
        method: 'POST',
        headers: petHeaders,
        body: JSON.stringify({
          id: `msg_e2_at_${randomUUID()}`,
          group: GROUP_NAME,
          prompt: `@${otherAgent.displayName} E2 @验收 ${new Date().toISOString()} — 请仅确认收到，勿深层委派。`,
        }),
      });
      assert(at.status === 200, `@ chat ${at.status} ${JSON.stringify(at.body)}`);
      assert(at.body.mentionedAgent === otherAgent.displayName, `@ must target ${otherAgent.displayName}`);
      assert(at.body.coordinatorAgent === otherAgent.displayName, 'coordinatorAgent follows @');
    } else {
      const atAdmin = await jsonFetch(`${base}/v1/chat`, {
        method: 'POST',
        headers: petHeaders,
        body: JSON.stringify({
          id: `msg_e2_atadmin_${randomUUID()}`,
          group: GROUP_NAME,
          prompt: `@${adminName} E2 @管理员验收 ${new Date().toISOString()} — 请仅确认收到。`,
        }),
      });
      assert(atAdmin.status === 200 && atAdmin.body.mentionedAgent === adminName, '@admin must work');
    }

    console.log('\nE2_AT_MENTION_OK');
    console.log(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          adminAgent: adminName,
          otherAgent: otherAgent?.displayName || null,
          noAtMessageId: noAt.body.messageId,
          selfMemberId: members.body.selfMemberId,
          selfDisplayName: selfRow.displayName,
        },
        null,
        2
      )
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
