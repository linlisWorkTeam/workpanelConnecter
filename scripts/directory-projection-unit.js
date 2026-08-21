import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, db, openDb, writeTx } from '../src/relay/db.js';
import {
  listDirectoryEndpoints,
  listDirectorySubjects,
  projectWpGroupMembers,
  upsertRunnerDirectoryTx,
} from '../src/relay/directory.js';
import { groupRef } from '../src/relay/services/identityService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-directory-'));
try {
  openDb(path.join(root, 'connector.db'));
  const registration = {
    protocolVersion: 2,
    maxConcurrency: 2,
    load: 0.25,
    labels: { region: 'hk' },
    capabilities: [{ name: 'code.review', version: '1', labels: {}, limits: {} }],
  };
  await writeTx((database) => {
    upsertRunnerDirectoryTx(database, { host: { siteId: 'site-a' } }, {
      runnerId: 'same-name', displayName: 'Agent', runtime: 'local',
      bindings: [{ groupId: 'group-1', role: 'agent' }], registration, online: true,
    });
    upsertRunnerDirectoryTx(database, { host: { siteId: 'site-b' } }, {
      runnerId: 'same-name', displayName: 'Agent', runtime: 'remote',
      bindings: [{ groupId: 'group-1', role: 'agent' }], registration, online: true,
    });
  });
  const all = listDirectorySubjects({ kind: 'agent', online: true });
  assert.equal(all.length, 2);
  assert.notEqual(all[0].subject_id, all[1].subject_id);
  const siteARef = groupRef({ authority: 'site-a', groupId: 'group-1' });
  assert.equal(listDirectorySubjects({ groupRef: siteARef }).length, 1);
  assert.equal(listDirectoryEndpoints({ capability: 'code.review', siteId: 'site-a' }).length, 1);

  await projectWpGroupMembers(
    { host: { siteId: 'site-a' } },
    'group-wp',
    [
      { id: 'member-user', kind: 'user', authUserId: 'user-1', displayName: 'User', isActive: true },
      { id: 'member-agent', kind: 'agent', displayName: 'WP Agent', isActive: true },
    ],
    ['user-1']
  );
  const wpRef = groupRef({ authority: 'site-a', groupId: 'group-wp' });
  assert.equal(listDirectorySubjects({ groupRef: wpRef, online: true }).length, 2);
  db().prepare(`UPDATE presence_observations SET expires_at=datetime('now','-1 second')`).run();
  assert.equal(listDirectorySubjects({ online: true }).length, 0);
  console.log('DIRECTORY_PROJECTION_UNIT_OK');
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
