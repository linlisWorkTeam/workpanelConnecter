import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  isStaleGroupFetch,
  matchAgentPrefix,
  matchesOptimisticBubble,
  renderMessageAuthor,
  shouldStartConsolePolling,
  stripPetStamp,
} from '../ui/petStamp.js';

const sdkPath = fileURLToPath(new URL('../ui/connecterApi.js', import.meta.url));

function loadSdk(extra = {}) {
  const code = fs.readFileSync(sdkPath, 'utf8');
  const sandbox = {
    self: {},
    console,
    module: { exports: {} },
    URLSearchParams,
    encodeURIComponent,
    ...extra,
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(code, sandbox, { filename: path.basename(sdkPath) });
  return sandbox.module.exports;
}

test('prefix matches Cursor Agent before Cursor', () => {
  const agents = [
    { displayName: 'Cursor', kind: 'agent' },
    { displayName: 'Cursor Agent', kind: 'agent' },
  ];
  assert.equal(matchAgentPrefix('Cursor A', agents).displayName, 'Cursor Agent');
});

test('stripPetStamp extracts petDisplayName and contentDisplay', () => {
  const stamped = '【WorkPet:林的Pet】\n修一下';
  assert.deepEqual(stripPetStamp(stamped), {
    petDisplayName: '林的Pet',
    contentDisplay: '修一下',
  });
});

test('stripPetStamp leaves unstamped content alone', () => {
  assert.deepEqual(stripPetStamp('plain'), {
    petDisplayName: null,
    contentDisplay: 'plain',
  });
});

test('optimistic bubble matches stamped WP transcript as one bubble', () => {
  const content = '@Cursor Agent\n【WorkPet:林的Pet】\n修一下';
  const stripped = stripPetStamp(content);
  assert.equal(stripped.contentDisplay, '@Cursor Agent\n修一下');
  assert.equal(
    matchesOptimisticBubble('修一下', { content, contentDisplay: stripped.contentDisplay }),
    true
  );
  assert.equal(matchesOptimisticBubble('修一下', { content }), true);
  assert.equal(matchesOptimisticBubble('修一下@Cursor Agent ', { content }), true);
  assert.equal(matchesOptimisticBubble('@Cursor Agent 修一下', { content }), true);
  assert.equal(matchesOptimisticBubble('别的话', { content }), false);
});

test('renderMessageAuthor prefers petDisplayName then senderDisplayName', () => {
  assert.equal(
    renderMessageAuthor({ petDisplayName: '林的Pet', senderDisplayName: 'Local User' }, '林的Pet'),
    '林的Pet'
  );
  assert.equal(
    renderMessageAuthor({ petDisplayName: null, senderDisplayName: 'Local User' }, '林的Pet'),
    'Local User'
  );
});

test('chat body includes petName from options or cfg', () => {
  const { createConnecterClient } = loadSdk();
  const { buildChatBody } = createConnecterClient({
    connecterBaseUrl: 'http://127.0.0.1:9',
    token: 't',
    petName: 'cfgPet',
    env: 'canary',
    group: 'g1',
    agent: 'a1',
  });
  const withOpt = JSON.parse(JSON.stringify(buildChatBody('hi', { petName: 'optPet', id: 'm1' })));
  assert.deepEqual(withOpt, {
    id: 'm1',
    prompt: 'hi',
    env: 'canary',
    group: 'g1',
    agent: 'a1',
    petName: 'optPet',
  });
  assert.equal(buildChatBody('hi', {}).petName, 'cfgPet');
});

test('console chat with group omits cfg.agent so coordinator can run', () => {
  const { createConnecterClient } = loadSdk();
  const { buildChatBody } = createConnecterClient({
    connecterBaseUrl: 'http://127.0.0.1:9',
    token: 't',
    petName: 'cfgPet',
    env: 'canary',
    group: 'default-group',
    agent: 'cfgAgent',
  });
  const consoleSend = JSON.parse(
    JSON.stringify(buildChatBody('hi', { group: 'g1', petName: 'optPet', id: 'm1' }))
  );
  assert.deepEqual(consoleSend, {
    id: 'm1',
    prompt: 'hi',
    env: 'canary',
    group: 'g1',
    petName: 'optPet',
  });
  assert.equal('agent' in consoleSend, false);

  const withAgent = JSON.parse(
    JSON.stringify(buildChatBody('hi', { group: 'g1', agent: 'explicit', id: 'm1' }))
  );
  assert.equal(withAgent.agent, 'explicit');

  const legacy = JSON.parse(JSON.stringify(buildChatBody('hi', { id: 'm1' })));
  assert.equal(legacy.agent, 'cfgAgent');
});

test('shouldStartConsolePolling requires open panel and no pause', () => {
  assert.equal(shouldStartConsolePolling({ panelOpen: true, consolePaused: false }), true);
  assert.equal(shouldStartConsolePolling({ panelOpen: false, consolePaused: false }), false);
  assert.equal(shouldStartConsolePolling({ panelOpen: true, consolePaused: true }), false);
});

test('isStaleGroupFetch detects group switch and collapsed panel', () => {
  assert.equal(isStaleGroupFetch('g1', 'g1', true), false);
  assert.equal(isStaleGroupFetch('g1', 'g2', true), true);
  assert.equal(isStaleGroupFetch('g1', 'g1', false), true);
  assert.equal(isStaleGroupFetch('', 'g1', true), true);
});

test('groups group groupMessages build expected paths', async () => {
  const calls = [];
  const { createConnecterClient } = loadSdk({
    fetch: async (url, opts) => {
      calls.push({ url: String(url), opts });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const client = createConnecterClient({
    connecterBaseUrl: 'http://example.test',
    token: 'tok',
    env: 'canary',
  });
  await Promise.all([
    client.groups({ env: 'prod' }),
    client.group('g 1', {}),
    client.groupMessages('g 1', { limit: 20 }),
  ]);
  assert.equal(calls[0].url, 'http://example.test/v1/groups?env=prod');
  assert.equal(calls[1].url, 'http://example.test/v1/groups/g%201?env=canary');
  assert.equal(
    calls[2].url,
    'http://example.test/v1/groups/g%201/messages?env=canary&limit=20'
  );
});
