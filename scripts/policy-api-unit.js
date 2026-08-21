#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizeFederation } from '../src/relay/accessPolicy.js';
import { closeDb, db } from '../src/relay/db.js';
import { listenRelay } from '../src/relay/server.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-policy-api-'));
const port = 9117;
const configPath = path.join(root, 'relay.json');
const dbPath = path.join(root, 'connector.db');
fs.writeFileSync(configPath, JSON.stringify({
  listen: { host: '127.0.0.1', port }, db: { path: dbPath }, auth: { tokens: ['ops-policy'] },
  pets: [{ id: 'pet-policy', token: 'pet-policy-token', groups: [] }], runners: [], backends: {},
}));
async function call(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { status: response.status, body: await response.json() };
}

const boot = await listenRelay({ configPath, dbPath, resume: false });
try {
  const petHeaders = { authorization: 'Bearer pet-policy-token', 'content-type': 'application/json' };
  assert.equal((await call('/v1/ops/federation/policies', { headers: petHeaders })).status, 403);
  const opsHeaders = { authorization: 'Bearer ops-policy', 'content-type': 'application/json' };
  const input = { id: 'policy-api', originSite: 'site-a', targetSite: 'site-b', groupRef: 'wp:site-a:g',
    subjectId: 'subject-b', operation: 'chat.command', direction: 'outbound', capability: 'code.review',
    dataClassification: 'confidential', effect: 'allow', version: 'api/v1' };
  const created = await call('/v1/ops/federation/policies', { method: 'POST', headers: opsHeaders, body: JSON.stringify(input) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await call('/v1/ops/federation/policies?status=active', { headers: opsHeaders })).body.policies.length, 1);
  const query = { originSite: 'site-a', targetSite: 'site-b', groupRef: 'wp:site-a:g', subjectId: 'subject-b',
    operation: 'chat.command', direction: 'outbound', capabilities: ['code.review'], dataClassification: 'confidential' };
  assert.equal(authorizeFederation({}, query).allowed, true);
  const disabled = await call('/v1/ops/federation/policies/policy-api/disable', { method: 'POST', headers: opsHeaders, body: '{}' });
  assert.equal(disabled.status, 200);
  assert.equal(authorizeFederation({}, query).allowed, false);
  assert.equal(db().prepare(`SELECT COUNT(*) n FROM audit_events WHERE event_type IN ('policy.create','policy.disable')`).get().n, 2);
  console.log('POLICY_API_UNIT_OK');
} finally {
  await new Promise((resolve) => boot.server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
