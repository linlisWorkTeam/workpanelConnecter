#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pickSender, selfInGroup, serverForPet, findPetConfig } from '../src/workpanelClient.js';
import { setSessionWpAuth, clearSessionWpAuth } from '../src/relay/sessionWpAuth.js';

const group = { ownerMemberId: 'owner-1', adminMemberId: 'ag-1' };
const members = [
  { id: 'owner-1', kind: 'user', displayName: '我', isActive: true, authUserId: null },
  { id: 'u-lin', kind: 'user', displayName: '林', isActive: true, authUserId: 'user-lin' },
  { id: 'ag-1', kind: 'agent', displayName: 'Cursor Agent', isActive: true },
];

assert.equal(pickSender(group, members, { userId: 'user-lin' }).id, 'u-lin');
assert.equal(pickSender(group, members, { userId: 'user-lin' }).displayName, '林');
assert.equal(pickSender(group, members, { userId: 'nobody' }).id, 'owner-1', 'unlinked owner fallback');
assert.equal(pickSender(group, members, {}).id, 'owner-1');
assert.equal(pickSender({ ownerMemberId: 'u-lin' }, members, { userId: 'missing' }), null);

const linkedOwner = members.map((m) =>
  m.id === 'owner-1' ? { ...m, authUserId: 'seed-root' } : m
);
assert.equal(pickSender(group, linkedOwner, { userId: 'seed-root' }).id, 'owner-1');
assert.equal(
  pickSender(group, linkedOwner, { userId: 'other' }),
  null,
  'do not steal another linked owner'
);

const petMember = [
  { id: 'p1', kind: 'pet', displayName: '林的Pet', isActive: true, authUserId: 'user-lin' },
];
assert.equal(pickSender({}, petMember, { userId: 'user-lin' }).kind, 'pet');

const backend = { baseUrl: 'http://127.0.0.1:8081', auth: { username: 'root', password: 'root' } };
const config = {
  pets: [
    {
      id: 'pet-1',
      wpAuth: { username: 'lin', password: 'secret' },
    },
  ],
};
assert.equal(findPetConfig(config, 'pet-1').id, 'pet-1');
assert.deepEqual(serverForPet(backend, config, 'pet-1').auth, { username: 'lin', password: 'secret' });
assert.deepEqual(serverForPet(backend, config, 'unknown').auth, backend.auth);
setSessionWpAuth('pet-1', { username: 'live', password: 'now' });
assert.deepEqual(serverForPet(backend, config, 'pet-1').auth, { username: 'live', password: 'now' });
clearSessionWpAuth();
assert.deepEqual(serverForPet(backend, config, 'pet-1').auth, { username: 'lin', password: 'secret' });

assert.equal(
  selfInGroup(group, members, { userId: 'user-lin' }),
  true,
  'linked member can see the group'
);
assert.equal(
  selfInGroup(group, members, { userId: 'nobody' }),
  false,
  'bound group hides people who are not members'
);
assert.equal(
  selfInGroup(group, [{ id: 'owner-1', kind: 'user', displayName: '我', isActive: true }], {
    userId: 'seed-root',
  }),
  true,
  'unbound members: trust WP list until authUserId is filled'
);

console.log('IDENTITY_UNIT_OK');
