import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, db } from '../src/relay/db.js';
import { authorizeFederation } from '../src/relay/accessPolicy.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-policy-'));
openDb(path.join(root, 'policy.db'));
try {
  const query = { originSite: 'site-a', targetSite: 'site-b', groupRef: 'wp:site-a:g', subjectId: 'subject-b', operation: 'chat.command', direction: 'outbound' };
  assert.equal(authorizeFederation({}, query).reason, 'DEFAULT_DENY');
  db().prepare(`INSERT INTO federation_policies (id,origin_site,target_site,group_ref,subject_id,operation,direction,effect,version) VALUES ('allow','site-a','site-b','wp:site-a:g','subject-b','chat.command','outbound','allow','test/v1')`).run();
  assert.equal(authorizeFederation({}, query).allowed, true);
  assert.equal(authorizeFederation({}, { ...query, groupRef: 'wp:site-a:other' }).allowed, false);
  assert.equal(authorizeFederation({}, { ...query, subjectId: 'other' }).allowed, false);
  assert.equal(authorizeFederation({}, { ...query, operation: 'admin' }).allowed, false);
  assert.equal(authorizeFederation({}, { ...query, direction: 'inbound' }).allowed, false);
  db().prepare(`INSERT INTO federation_policies
    (id,origin_site,target_site,group_ref,subject_id,operation,direction,capability,data_classification,effect,version)
    VALUES ('classified','site-a','site-b','wp:site-a:classified','subject-b','chat.command','outbound','code.review','confidential','allow','classified/v1')`).run();
  const classified = { ...query, groupRef: 'wp:site-a:classified', capabilities: ['code.review'], dataClassification: 'confidential' };
  assert.equal(authorizeFederation({}, classified).allowed, true);
  assert.equal(authorizeFederation({}, { ...classified, capabilities: ['image.generate'] }).allowed, false);
  assert.equal(authorizeFederation({}, { ...classified, dataClassification: 'restricted' }).allowed, false);
  assert.equal(authorizeFederation({}, { ...classified, capabilities: ['code.review', 'image.generate'] }).allowed, false);
  db().prepare(`INSERT INTO federation_policies (id,origin_site,target_site,group_ref,subject_id,operation,direction,effect,version) VALUES ('deny','site-a','site-b','wp:site-a:g','subject-b','chat.command','outbound','deny','deny/v1')`).run();
  const configAllow = { federation: { policies: [{ originSite: 'site-a', targetSite: 'site-b', groupRef: 'wp:site-a:g', subjectId: 'subject-b', operation: 'chat.command', direction: 'outbound', effect: 'allow' }] } };
  assert.equal(authorizeFederation(configAllow, query).reason, 'POLICY_DENY');
  console.log('POLICY_MATRIX_UNIT_OK');
} finally { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
