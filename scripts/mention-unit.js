#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractMentionTarget, pickAdminAgent } from '../src/relay/mentions.js';

const members = [
  { id: 'a', kind: 'agent', displayName: 'Cursor Agent', isActive: true },
  { id: 'b', kind: 'agent', displayName: 'cs', isActive: true },
  { id: 'u', kind: 'user', displayName: '林', isActive: true },
];

let r = extractMentionTarget('E2 无@验收 hello', members);
assert.equal(r.hasAt, false);

r = extractMentionTarget('@cs 干活', members);
assert.equal(r.target.displayName, 'cs');

r = extractMentionTarget('@Cursor Agent please', members);
assert.equal(r.target.displayName, 'Cursor Agent');

r = extractMentionTarget('@nobody', members);
assert.equal(r.hasAt, true);
assert.equal(r.target, null);

r = extractMentionTarget('@林 你好', members);
assert.equal(r.target.kind, 'user');

const admin = pickAdminAgent({ adminMemberId: 'a' }, members);
assert.equal(admin.displayName, 'Cursor Agent');
assert.equal(pickAdminAgent({ adminMemberId: 'u' }, members), null);
assert.equal(pickAdminAgent({}, members), null);

console.log('MENTION_UNIT_OK');
