import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, db, openDb, writeTx } from '../src/relay/db.js';
import { upsertRunnerDirectoryTx } from '../src/relay/directory.js';
import { resolveRoute } from '../src/relay/routeResolver.js';
import { groupRef } from '../src/relay/services/identityService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-route-'));
try {
  openDb(path.join(root, 'connector.db'));
  const registration = (load, capabilities) => ({
    protocolVersion: 2, maxConcurrency: 2, load, labels: {},
    capabilities: capabilities.map((name) => ({ name, version: '1', labels: {}, limits: {} })),
  });
  await writeTx((database) => {
    const sharedGroupRef = groupRef({ authority: 'site-a', groupId: 'group-1' });
    upsertRunnerDirectoryTx(database, { host: { siteId: 'site-a' } }, {
      runnerId: 'runner-local', displayName: 'Reviewer', runtime: 'local',
      bindings: [{ groupId: 'group-1', groupRef: sharedGroupRef }], registration: registration(0.8, ['code.review']), online: true,
    });
    upsertRunnerDirectoryTx(database, { host: { siteId: 'site-b' } }, {
      runnerId: 'runner-remote', displayName: 'Reviewer', runtime: 'remote',
      bindings: [{ groupId: 'group-1', groupRef: sharedGroupRef }], registration: registration(0.1, ['code.review']), online: true,
    });
  });
  const ref = groupRef({ authority: 'site-a', groupId: 'group-1' });
  const ambiguous = resolveRoute({
    groupRef: ref, agentName: 'Reviewer', requiredCapabilities: ['code.review'], sourceSiteId: 'site-a',
  });
  assert.equal(ambiguous.target, null);
  assert.equal(ambiguous.reason, 'AMBIGUOUS_SUBJECT');
  const localSubjectId = ambiguous.considered.find((item) => item.localId === 'runner-local').subjectId;
  const remoteSubjectId = ambiguous.considered.find((item) => item.localId === 'runner-remote').subjectId;
  const local = resolveRoute({
    groupRef: ref, targetSubjectId: localSubjectId, requiredCapabilities: ['code.review'], sourceSiteId: 'site-a',
  });
  assert.equal(local.target.localId, 'runner-local');
  assert.equal(local.reason, 'LOCAL_ELIGIBLE_ENDPOINT');
  const explicitRemote = resolveRoute({
    groupRef: ref,
    targetSubjectId: remoteSubjectId,
    requiredCapabilities: ['code.review'], sourceSiteId: 'site-a',
  });
  assert.equal(explicitRemote.target.localId, 'runner-remote');
  const missing = resolveRoute({
    groupRef: ref, targetSubjectId: localSubjectId, requiredCapabilities: ['image.generate'], sourceSiteId: 'site-a',
  });
  assert.equal(missing.target, null);
  assert.equal(missing.considered[0].reason, 'CAPABILITY_MISSING');
  const outsider = resolveRoute({
    groupRef: groupRef({ authority: 'site-a', groupId: 'other' }),
    agentName: 'Reviewer', sourceSiteId: 'site-a',
  });
  assert.equal(outsider.target, null);
  assert.equal(outsider.reason, 'NO_MATCHING_SUBJECT');
  db().prepare(`UPDATE endpoints SET expires_at=datetime('now','-1 second')`).run();
  const offline = resolveRoute({ groupRef: ref, targetSubjectId: localSubjectId, sourceSiteId: 'site-a' });
  assert.equal(offline.target, null);
  assert.equal(offline.reason, 'NO_ONLINE_ENDPOINT');
  console.log('ROUTE_RESOLVER_UNIT_OK');
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
