# WorkPet Mini Group Console Implementation Plan

> 文档状态：已执行的历史实施计划；当前用户行为与 API 见 `apps/workpet/README.md` 和 `docs/api-relay.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand WorkPet into a mini group console (switch façade-visible groups, member online, `@Agent` dispatch, recent WP messages) while the pet still talks only to Connecter.

**Architecture:** Connecter proxies WorkPanel `GET /api/groups`, `GET /api/groups/{id}`, `GET /api/groups/{id}/messages`, and `GET /api/presence`. Chat still uses the façade sender; `@` changes mention target; a `【WorkPet:{petName}】` stamp lets the pet UI label its own bubbles. No WorkPet WP login (P2.5).

**Tech Stack:** Node ≥18 ESM relay (`src/relay`, `src/workpanelClient.js`); WorkPet Tauri UI (`apps/workpet/ui`); mock WP (`mock/workpanel-server.js`); tests via `node --test` plus existing `npm run test:relay-unit`.

**Spec:** `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md`

## Global Constraints

- Connecter only relays/schedules; no business webpage; WorkPet does not call WorkPanel directly.
- Default env is `canary`; pet + `prod` with `allowProdFromPet=false` → `403` `PROD_FORBIDDEN`.
- Pet token group visibility equals the WP façade account on that env (G3, G11).
- Wire sender remains the façade user (G4); console author for stamped lines is `petName` (G5).
- Unknown `@` → do not send, `400` `UNKNOWN_MENTION` (G6). No `@` → duty/coordinator agent (G7).
- Do not regress `GET /v1/messages` ack polling (G10).
- Do not implement WP Pet membership or WorkPet login (G12 / P2.5).
- Existing `npm run test:relay-unit`, `npm run test:ui` must stay green.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/relay/petStamp.js` | `@` longest-match parse; stamp format/strip |
| `src/workpanelClient.js` | WP list groups / group state / messages / presence; chat mention override |
| `src/relay/groupConsole.js` | Assemble `/v1/groups*` DTOs; default coordinator resolution |
| `src/relay/registry.js` | Rate-limit buckets `chat` vs `console`; `ensureAgentInstance` |
| `src/relay/authPet.js` | Pass rate bucket into `checkRateLimit` |
| `src/relay/handlers.js` | New group handlers; chat unbound group + stamp |
| `src/relay/server.js` | Routes `/v1/groups`, `/v1/groups/:id`, `/v1/groups/:id/messages` |
| `mock/workpanel-server.js` | `GET /api/presence`, `GET /api/groups/:id/messages`; do not swallow `/messages` in the group-state route |
| `scripts/group-console-unit.js` | Relay unit tests for stamp, groups handlers, chat mention |
| `apps/workpet/ui/connecterApi.js` | SDK: `groups`, `group`, `groupMessages` |
| `apps/workpet/ui/petStamp.js` | Client stamp strip + `@` prefix match for autocomplete |
| `apps/workpet/ui/index.html` `main.js` `style.css` | Console UI |
| `docs/api-relay.md` | Freeze new endpoints |

---

### Task 1: Stamp and mention parsers

**Files:**
- Create: `src/relay/petStamp.js`
- Test: `scripts/group-console-unit.js` (create)
- Modify: `package.json` (add `"test:group-console": "node scripts/group-console-unit.js"`)

**Interfaces:**
- Produces: `parseAgentMention(prompt, members) → { ok, agent, rest, error?, code? }`; `formatPetStamp(petName)`; `applyPetStamp(content, petName)`; `stripPetStamp(content) → { petDisplayName, contentDisplay }`

- [ ] **Step 1: Write the failing test**

Create `scripts/group-console-unit.js`:

```js
#!/usr/bin/env node
import assert from 'node:assert/strict';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/group-console-unit.js`

Expected: `ERR_MODULE_NOT_FOUND` for `src/relay/petStamp.js`

- [ ] **Step 3: Write minimal implementation**

Create `src/relay/petStamp.js`:

```js
const STAMP_RE = /^【WorkPet:([^】]{1,32})】\s*/m;

export function sanitizePetName(value) {
  const name = String(value || '').trim().slice(0, 32);
  return name || 'WorkPet';
}

export function formatPetStamp(petName) {
  return `【WorkPet:${sanitizePetName(petName)}】`;
}

export function applyPetStamp(body, petName) {
  const text = String(body || '').trim();
  return `${formatPetStamp(petName)}\n${text}`.trim();
}

export function stripPetStamp(content) {
  const raw = String(content || '');
  const match = raw.match(STAMP_RE);
  if (!match) return { petDisplayName: null, contentDisplay: raw };
  return {
    petDisplayName: match[1],
    contentDisplay: raw.replace(STAMP_RE, '').trim(),
  };
}

export function parseAgentMention(prompt, members) {
  const text = String(prompt || '');
  const at = text.indexOf('@');
  if (at === -1) {
    return { ok: true, agent: null, rest: text.trim() };
  }
  const after = text.slice(at + 1);
  const agents = (members || []).filter((m) => m.kind === 'agent' && m.displayName);
  const hit = agents
    .slice()
    .sort((a, b) => b.displayName.length - a.displayName.length)
    .find((m) => after === m.displayName || after.startsWith(`${m.displayName} `) || after.startsWith(`${m.displayName}\n`));
  if (!hit) {
    return { ok: false, agent: null, rest: text, error: 'unknown @mention', code: 'UNKNOWN_MENTION' };
  }
  const rest = after.slice(hit.displayName.length).trim();
  return { ok: true, agent: hit, rest };
}
```

Add to `package.json` scripts: `"test:group-console": "node scripts/group-console-unit.js"`

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js`

Expected: `GROUP_CONSOLE_UNIT_OK parsers`

- [ ] **Step 5: Commit**

```bash
git add src/relay/petStamp.js scripts/group-console-unit.js package.json
git commit -m "feat: parse WorkPet @Agent mentions and display stamps"
```

---

### Task 2: Mock WP messages and presence

**Files:**
- Modify: `mock/workpanel-server.js`
- Test: extend `scripts/group-console-unit.js` with a short HTTP fetch against the mock, or a dedicated block started/stopped in-process

**Interfaces:**
- Consumes: existing mock groups/members
- Produces: `GET /api/presence` → `{ onlineUserIds: string[] }`; `GET /api/groups/:id/messages` → `{ messages: [...] }`

- [ ] **Step 1: Write the failing test**

Append to `scripts/group-console-unit.js` (dynamic import of mock is awkward). Instead add a function export from the mock **or** inline a 20-line server in the test file.

Prefer fixing the mock and probing it:

At the bottom of `mock/workpanel-server.js` today it `listen`s immediately. Keep that. In the unit script, skip live listen; **assert route order in a copied helper**.

Simplest reliable test: export `handleWorkpanel(req, res)` from mock (refactor) then unit-test it with `http.request` against `createServer(handleWorkpanel)`.

If refactoring the mock is too large, add routes first and test via:

```js
import http from 'node:http';
```

and spawn `node mock/workpanel-server.js` with `PORT=18081` in the unit script using `child_process`, fetch, then kill.

Use child_process:

```js
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

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
```

Test cases (will fail until routes exist):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/group-console-unit.js`

Expected: presence or messages `404`

- [ ] **Step 3: Implement mock routes**

In `mock/workpanel-server.js`, **before** the generic `GET /api/groups/` handler, add:

```js
if (req.method === 'GET' && path === '/api/presence') {
  return send(res, 200, { onlineUserIds: [user.id] });
}

const messagesMatch = path.match(/^\/api\/groups\/([^/]+)\/messages$/);
if (req.method === 'GET' && messagesMatch) {
  const target = groups.find((g) => g.id === decodeURIComponent(messagesMatch[1]));
  if (!target) return send(res, 404, { error: 'group not found' });
  return send(res, 200, {
    messages: [
      {
        id: 'wp_hist_1',
        senderMemberId: user.id,
        senderDisplayName: user.displayName,
        senderKind: 'user',
        content: 'hello from group',
        mentionMemberIds: [],
        ts: Date.now(),
      },
    ],
  });
}
```

Keep `GET /api/groups/:id` as exact one extra path segment only:

```js
if (req.method === 'GET' && path.startsWith('/api/groups/')) {
  const rest = decodeURIComponent(path.slice('/api/groups/'.length));
  if (rest.includes('/')) return send(res, 404, { error: 'not found', path });
  ...
}
```

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js`

Expected: parsers + mock fetches pass. Also run `npm run test:relay-unit` (must still pass).

- [ ] **Step 5: Commit**

```bash
git add mock/workpanel-server.js scripts/group-console-unit.js
git commit -m "test: mock WP presence and group message list"
```

---

### Task 3: WorkPanel client group read APIs + stamped dispatch

**Files:**
- Modify: `src/workpanelClient.js`
- Test: `scripts/group-console-unit.js`

**Interfaces:**
- Consumes: `wpLogin`, `fetchJson`, `wpResolveGroup`
- Produces: `wpListGroups(server)`, `wpGetGroup(server, groupId)`, `wpListGroupMessages(server, groupId, { limit })`, `wpGetPresence(server)`; `dispatchWorkPanel(server, team, prompt, { mentionAgentName, petName } = {})`

- [ ] **Step 1: Write the failing test**

```js
import { wpListGroups, wpGetPresence, dispatchWorkPanel } from '../src/workpanelClient.js';

await withMock(async (base) => {
  const server = { baseUrl: base, auth: { username: 'root', password: 'root' } };
  const groups = await wpListGroups(server);
  assert.equal(groups.ok, true);
  assert.ok(groups.groups.length >= 1);
  const presence = await wpGetPresence(server);
  assert.equal(presence.ok, true);
  assert.ok(presence.onlineUserIds.includes('user-local'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `wpListGroups is not a function`

- [ ] **Step 3: Implement**

Add exports using existing `fetchJson` / `wpLogin` / `baseOf`:

```js
export async function wpListGroups(server, { timeoutMs = 5000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  const res = await fetchJson(`${baseOf(server)}/api/groups`, { token, timeoutMs });
  if (!res.ok || !Array.isArray(res.json)) {
    return { ok: false, error: `wp list groups HTTP ${res.status}`, groups: [] };
  }
  return { ok: true, groups: res.json, error: null };
}

export async function wpGetGroup(server, groupId, { timeoutMs = 5000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  const res = await fetchJson(
    `${baseOf(server)}/api/groups/${encodeURIComponent(groupId)}`,
    { token, timeoutMs }
  );
  if (!res.ok) return { ok: false, status: res.status, error: `wp group HTTP ${res.status}` };
  return { ok: true, group: res.json.group || res.json, members: res.json.members || [] };
}

export async function wpGetPresence(server, { timeoutMs = 5000 } = {}) {
  try {
    const token = await wpLogin(server, { timeoutMs });
    const res = await fetchJson(`${baseOf(server)}/api/presence`, { token, timeoutMs });
    if (!res.ok) return { ok: false, onlineUserIds: [], error: `wp presence HTTP ${res.status}` };
    return { ok: true, onlineUserIds: res.json.onlineUserIds || [], error: null };
  } catch (err) {
    return { ok: false, onlineUserIds: [], error: String(err.message || err) };
  }
}

export async function wpListGroupMessages(server, groupId, { limit = 50, timeoutMs = 5000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  const q = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(limit) || 50))) });
  const res = await fetchJson(
    `${baseOf(server)}/api/groups/${encodeURIComponent(groupId)}/messages?${q}`,
    { token, timeoutMs }
  );
  if (!res.ok) return { ok: false, messages: [], error: `wp messages HTTP ${res.status}` };
  const messages = Array.isArray(res.json?.messages) ? res.json.messages : [];
  return { ok: true, messages, error: null };
}
```

Change `dispatchWorkPanel` content build (keep default banner when `petName` omitted):

```js
export async function dispatchWorkPanel(server, team, prompt, options = {}) {
  // ... existing health/login/resolve/sender checks ...
  const mentionName = options.mentionAgentName || team.coordinatorAgentName;
  const mention =
    (mentionName && members.find((m) => m.kind === 'agent' && m.isActive && m.displayName === mentionName)) ||
    coordinator;
  if (!mention) { /* same no-agent failure */ }

  let content;
  if (options.petName) {
    const parsed = parseAgentMention(prompt, members);
    const rest = parsed.ok && parsed.agent ? parsed.rest : String(prompt || '').trim();
    content = `@${mention.displayName}\n${formatPetStamp(options.petName)}\n${rest}`.trim();
  } else {
    content = `@${mention.displayName} 【Connecter 调度】\n${prompt}`;
  }

  const res = await fetchJson(`${baseOf(server)}/api/messages`, {
    method: 'POST',
    token,
    timeoutMs,
    body: {
      groupId: group.id,
      senderMemberId: sender.id,
      content,
      mentionMemberIds: [mention.id],
    },
  });
  // ... existing response mapping; add mentionedAgent: mention.displayName on body ...
}
```

Import `parseAgentMention` and `formatPetStamp` from `./relay/petStamp.js` — **wrong directory**. From `src/workpanelClient.js` import `./relay/petStamp.js`.

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js`

Expected: list/presence pass. Run `npm run test:relay-unit` still green.

- [ ] **Step 5: Commit**

```bash
git add src/workpanelClient.js scripts/group-console-unit.js
git commit -m "feat: proxy WP groups, presence, messages and stamped mentions"
```

---

### Task 4: Rate-limit buckets and `GET /v1/groups*`

**Files:**
- Modify: `src/relay/registry.js`, `src/relay/authPet.js`, `src/relay/server.js`, `src/relay/handlers.js`
- Create: `src/relay/groupConsole.js`
- Test: `scripts/group-console-unit.js` (handler-level with inline config + mock WP)

**Interfaces:**
- Consumes: `wpListGroups`, `wpGetGroup`, `wpGetPresence`, `resolveBackend`
- Produces: `handlers.groups(auth, query)`, `handlers.group(auth, id, query)`; `checkRateLimit(petId, limit, bucket)`

- [ ] **Step 1: Write the failing test**

Use `bootstrapRelay` + `createRelayServer` if that is how `relay-gate.js` works. Read `scripts/relay-gate.js` before writing; if it starts a real server, copy that pattern.

Handler-only test (no HTTP):

```js
import { createHandlers } from '../src/relay/handlers.js';

const handlers = createHandlers({
  config: {
    allowProdFromPet: false,
    defaults: { env: 'canary', coordinatorAgentName: 'Cursor Agent' },
    backends: {
      canary: {
        baseUrl: 'http://127.0.0.1:18081',
        kind: 'workpanel',
        auth: { username: 'root', password: 'root' },
      },
    },
  },
});

await withMock(async () => {
  const auth = { kind: 'pet', petId: 'pet-dev-1' };
  const list = await handlers.groups(auth, { env: 'canary' });
  assert.equal(list.status, 200);
  assert.ok(list.body.groups.length >= 1);
  const one = await handlers.group(auth, list.body.groups[0].id, { env: 'canary' });
  assert.equal(one.status, 200);
  assert.equal(typeof one.body.members[0].online, 'boolean');
});

const ops = await createHandlers({ config: { backends: { canary: { baseUrl: 'http://127.0.0.1:18081' } } } })
  .groups({ kind: 'ops' }, {});
assert.equal(ops.status, 403);
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `handlers.groups is not a function`

- [ ] **Step 3: Implement**

`checkRateLimit` in `registry.js`:

```js
export function checkRateLimit(petId, limitPerMin = 60, bucket = 'chat') {
  const key = `${petId}:${bucket}`;
  // same sliding window using key instead of petId
}
```

`authenticateRequest(req, config, { rateLimit = true, rateBucket = 'chat', limitPerMin } = {})` uses `limitPerMin ?? (rateBucket === 'console' ? config.consoleRateLimitPerMin ?? 120 : config.rateLimitPerMin ?? 60)`.

`groupConsole.js`:

```js
export function memberOnline(member, onlineUserIds) {
  if (member.kind === 'agent') return Boolean(member.isActive);
  const ids = new Set(onlineUserIds || []);
  return ids.has(member.id) || ids.has(member.userId);
}

export function toGroupListItem(g) {
  return {
    id: g.id,
    name: g.name,
    ...(g.unreadCount != null ? { unreadCount: g.unreadCount } : {}),
  };
}
```

Handlers: pet-only; resolve backend via `resolveBackend(config, env, { client: 'pet' })`; on WP failure `502` `WP_GROUPS_FAILED`.

`server.js` after auth:

```js
const consolePath = pathname === '/v1/groups' || pathname.startsWith('/v1/groups/');
```

Call `authenticateRequest` with `rateBucket: consolePath ? 'console' : 'chat'` — **must parse path before auth**. Currently auth runs before most routes; keep that, but compute bucket from `pathname`.

Routes:

- `GET /v1/groups` → `handlers.groups(auth, { env: url.searchParams.get('env') })`
- `GET /v1/groups/:id` where id has no extra slash → `handlers.group`
- `GET /v1/groups/:id/messages` → Task 5 (stub 404 until then, or implement empty in this task)

Implement list + detail in this task; messages can 404 until Task 5.

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js` and `npm run test:relay-unit`

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/relay/groupConsole.js src/relay/handlers.js src/relay/server.js src/relay/authPet.js src/relay/registry.js scripts/group-console-unit.js
git commit -m "feat: expose GET /v1/groups and group members with presence"
```

---

### Task 5: `GET /v1/groups/:id/messages`

**Files:**
- Modify: `src/relay/handlers.js`, `src/relay/server.js`, `src/relay/groupConsole.js`
- Test: `scripts/group-console-unit.js`

**Interfaces:**
- Consumes: `wpListGroupMessages`, `stripPetStamp`
- Produces: `handlers.groupMessages(auth, id, { env, limit })` → `{ messages: [{ id, ts, senderMemberId, senderDisplayName, senderKind, content, contentDisplay, petDisplayName, mentionMemberIds }] }`

- [ ] **Step 1: Write the failing test**

After Task 2 mock history message `hello from group`:

```js
const listed = await handlers.groupMessages(auth, 'local-group-1', { env: 'canary', limit: '50' });
assert.equal(listed.status, 200);
assert.equal(listed.body.messages[0].contentDisplay, 'hello from group');
assert.equal(listed.body.messages[0].petDisplayName, null);
```

Add a mock message with stamp in `mock/workpanel-server.js` so a second assertion can check `petDisplayName === '林的Pet'`.

- [ ] **Step 2: Run test to verify it fails**

Expected: `groupMessages is not a function` or 404 from server (handler test).

- [ ] **Step 3: Implement mapping**

```js
function mapWpMessage(row) {
  const { petDisplayName, contentDisplay } = stripPetStamp(row.content || '');
  return {
    id: row.id,
    ts: row.ts || row.createdAt || null,
    senderMemberId: row.senderMemberId,
    senderDisplayName: row.senderDisplayName || null,
    senderKind: row.senderKind || null,
    content: row.content,
    contentDisplay,
    petDisplayName,
    mentionMemberIds: row.mentionMemberIds || [],
  };
}
```

Wire `GET` `/v1/groups/:id/messages` in `server.js` **before** the single-id route, or split path: `parts = pathname.slice('/v1/groups/'.length).split('/')`.

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/relay/handlers.js src/relay/server.js src/relay/groupConsole.js mock/workpanel-server.js scripts/group-console-unit.js
git commit -m "feat: proxy recent WorkPanel group messages to WorkPet"
```

---

### Task 6: Chat to any façade group with `@` and stamp

**Files:**
- Modify: `src/relay/handlers.js`, `src/relay/registry.js`, `src/relay/delivery.js` (only if dispatch options must be plumbed through `deliverOnce`)
- Test: `scripts/group-console-unit.js`

**Interfaces:**
- Consumes: `parseAgentMention`, `wpGetGroup`, `ensureAgentInstance`, `dispatchWorkPanel(..., { mentionAgentName, petName })`
- Produces: pet `chat` 200 includes `mentionedAgent`; 400 `UNKNOWN_MENTION` / `NO_COORDINATOR`; unbound group allowed

- [ ] **Step 1: Write the failing tests**

```js
const bad = await handlers.chat(
  { prompt: '@不存在的人 你好', group: 'local-group-1', petName: '林的Pet' },
  { kind: 'pet', petId: 'pet-dev-1' }
);
assert.equal(bad.status, 400);
assert.equal(bad.body.code, 'UNKNOWN_MENTION');
```

Need bootstrap DB + pet session for real `acceptUpMessage`. Follow `scripts/relay-gate.js` setup (copy `bootstrapRelay` + temp sqlite + pets config pointing at mock). If gate is heavy, test mention resolution **before** DB by extracting `resolveChatTarget({ prompt, members, body, config, instance })` in `groupConsole.js` and unit-test that; then a thinner handler test.

**Required extract** `resolveChatTarget` in `src/relay/groupConsole.js`:

```js
export function resolveChatTarget({ prompt, members, requestedAgent, defaults }) {
  const parsed = parseAgentMention(prompt, members);
  if (!parsed.ok) return parsed;
  if (parsed.agent) return { ok: true, agent: parsed.agent, rest: parsed.rest };
  const name = requestedAgent || defaults.coordinatorAgentName;
  const agent = members.find((m) => m.kind === 'agent' && m.isActive && (!name || m.displayName === name))
    || members.find((m) => m.kind === 'agent' && m.isActive);
  if (!agent) return { ok: false, code: 'NO_COORDINATOR', error: 'no coordinator agent in group' };
  return { ok: true, agent, rest: parsed.rest };
}
```

Unit-test this fully. Handler integration: one chat through `createHandlers` + `bootstrapRelay` if feasible in <40 lines; otherwise gate later.

- [ ] **Step 2: Run test to verify it fails**

Expected: missing `resolveChatTarget` or chat still `no matching agent_instance`.

- [ ] **Step 3: Implement**

1. `ensureAgentInstance({ petId, env, groupId, groupName, agentName })` upserts `agent_instances` so `deliverOnce` still finds a row. Reuse insert pattern from `registry.js` bootstrap.
2. Pet chat path:
   - Resolve env (prod forbidden unchanged).
   - `wpGetGroup` for `body.group || body.groupId || defaults.group` (match by id or name).
   - `resolveChatTarget`.
   - `ensureAgentInstance` with chosen agent.
   - `acceptUpMessage` with **stamped rest** as stored content (original prompt ok too; delivery uses envelope content).
3. `deliverOnce`: pass `petName` and `mentionAgentName` into `dispatchWorkPanel`. Put them on `envelope.payload` (`petName`, `mentionAgentName`) when accepting so resume delivery stamps correctly.

`acceptUpMessage` / `makeEnvelope`: allow `payload` extra fields or store stamped content only (simpler): store `content` as the WP body (`@Agent\n【WorkPet】\nrest`). Then `dispatchWorkPanel` with `petName` would **double-stamp**. So either:

- Store original prompt; delivery applies stamp; **or**
- Store final WP content; `dispatchWorkPanel` gains `{ formattedContent }` skip wrap.

Choose **`formattedContent`**: if `envelope.payload.formatted === true`, POST `envelope.payload.content` as-is with `mentionMemberIds` from payload. Add `mentionAgentName` on payload for member lookup.

```js
payload: {
  content: `@${agent.displayName}\n${formatPetStamp(petName)}\n${rest}`,
  formatted: true,
  mentionAgentName: agent.displayName,
  petName,
}
```

`dispatchWorkPanel`: if `options.formattedContent`, use it as `content` and resolve mention from `options.mentionAgentName`.

- [ ] **Step 4: Run tests**

Run: `node scripts/group-console-unit.js` and `npm run test:relay-unit`

Expected: pass. If `test:relay` / canary gate is available locally, run it; do not require live canary.

- [ ] **Step 5: Commit**

```bash
git add src/relay/handlers.js src/relay/registry.js src/relay/groupConsole.js src/relay/delivery.js src/workpanelClient.js scripts/group-console-unit.js
git commit -m "feat: route pet chat to any façade group via @Agent"
```

---

### Task 7: WorkPet SDK + client stamp helper

**Files:**
- Modify: `apps/workpet/ui/connecterApi.js`
- Create: `apps/workpet/ui/petStamp.js`
- Test: `apps/workpet/tests/petStamp.test.mjs`
- Modify: `apps/workpet/package.json` `test:ui` to include the new test file

**Interfaces:**
- Consumes: same `request()` helper
- Produces: `groups({ env })`, `group(id, { env })`, `groupMessages(id, { env, limit })`; `chat(prompt, { group, agent, petName, id })` already exists — add `petName` field

- [ ] **Step 1: Write the failing test**

`apps/workpet/tests/petStamp.test.mjs` can re-test strip/prefix locally. For SDK, export a small `buildChatBody` or test `stripPetStamp` copy:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAgentPrefix, stripPetStamp } from '../ui/petStamp.js';

test('prefix matches Cursor Agent before Cursor', () => {
  const agents = [
    { displayName: 'Cursor', kind: 'agent' },
    { displayName: 'Cursor Agent', kind: 'agent' },
  ];
  assert.equal(matchAgentPrefix('Cursor A', agents).displayName, 'Cursor Agent');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/workpet/tests/petStamp.test.mjs`

Expected: module not found.

- [ ] **Step 3: Implement `petStamp.js` and SDK methods**

Client `stripPetStamp` must match server regex.

SDK:

```js
groups: (o = {}) => {
  const q = new URLSearchParams({ env: o.env || defaults.env });
  return request('/v1/groups?' + q.toString());
},
group: (id, o = {}) => {
  const q = new URLSearchParams({ env: o.env || defaults.env });
  return request('/v1/groups/' + encodeURIComponent(id) + '?' + q.toString());
},
groupMessages: (id, o = {}) => {
  const q = new URLSearchParams({
    env: o.env || defaults.env,
    limit: String(o.limit || 50),
  });
  return request('/v1/groups/' + encodeURIComponent(id) + '/messages?' + q.toString());
},
```

`chat` body add `petName: o.petName || cfg.petName`.

Update `apps/workpet/package.json` test:ui:

`"test:ui": "node --test tests/petConfig.test.mjs tests/connecterApi.test.mjs tests/petStamp.test.mjs"`

- [ ] **Step 4: Run tests**

Run: `npm run test:ui` (cwd `apps/workpet`)

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/workpet/ui/connecterApi.js apps/workpet/ui/petStamp.js apps/workpet/tests/petStamp.test.mjs apps/workpet/package.json
git commit -m "feat: WorkPet SDK for groups, members, and stamped chat"
```

---

### Task 8: Expanded panel UI

**Files:**
- Modify: `apps/workpet/ui/index.html`, `apps/workpet/ui/main.js`, `apps/workpet/ui/style.css`

**Interfaces:**
- Consumes: SDK `groups` / `group` / `groupMessages` / `chat`; `cfg.petName`, `cfg.pollIntervalMs`
- Produces: group `<select>`, member strip, transcript from WP messages, `@` insert

- [ ] **Step 1: Write a failing DOM-contract test** (no full jsdom in repo)

Do **not** add jsdom. Instead add a pure function `renderMessageAuthor(msg, petName)` in `apps/workpet/ui/petStamp.js` and test it:

```js
assert.equal(
  renderMessageAuthor({ petDisplayName: '林的Pet', senderDisplayName: 'Local User' }, '林的Pet'),
  '林的Pet'
);
assert.equal(
  renderMessageAuthor({ petDisplayName: null, senderDisplayName: 'Local User' }, '林的Pet'),
  'Local User'
);
```

Then implement UI against that helper.

- [ ] **Step 2: Run test to verify it fails** if `renderMessageAuthor` missing.

- [ ] **Step 3: Implement UI**

`index.html` inside `#panel`:

- Replace static `#panelTitle` with `<select id="groupSelect" aria-label="切换群聊">`
- Add `<div id="memberStrip" class="member-strip" aria-label="群成员"></div>` above `#msgList`

`main.js`:

- On `expand()`: `loadGroups()` → fill select; `selectGroup(id)` loads members + messages; start `setInterval` 2s messages, 10s members.
- `addGroupMsg` uses `contentDisplay` and `renderMessageAuthor`.
- Send: `client.chat(text, { group: currentGroupId, petName: cfg.petName, id })`. On 400 `UNKNOWN_MENTION`, bubble `找不到 @某某`.
- Click member (agent): insert `@${displayName} ` into `#input`.
- Input `@` keyup: show simple datalist of agent names (`<datalist id="agentMentions">`).
- Collapse: clear intervals.
- Persist `localStorage workpet.groupId`.
- Stop using `client.messages(cursor)` as the **main** list; do not delete the SDK method.

CSS: member chips, green/gray dots, select styled like existing badges. Keep 440×680.

- [ ] **Step 4: Run tests**

Run: `cd apps/workpet && npm run test:ui`

Expected: pass. Manual: `npm run dev` in `apps/workpet`, expand, switch groups.

- [ ] **Step 5: Commit**

```bash
git add apps/workpet/ui/index.html apps/workpet/ui/main.js apps/workpet/ui/style.css apps/workpet/ui/petStamp.js apps/workpet/tests/petStamp.test.mjs
git commit -m "feat: WorkPet expanded panel as mini group console"
```

---

### Task 9: Freeze docs

**Files:**
- Modify: `docs/api-relay.md`, `docs/NEXT-DEV-PATH.md` (P2.4 ⏳ → 实现中/✅ only if tests in this task are considered done; leave **⏳ 待实现** until Task 8 merged, then set **✅** in this task)

- [ ] **Step 1: Add `/v1/groups` sections to `docs/api-relay.md` matching the spec (auth matrix, 403 ops, 502 codes, `UNKNOWN_MENTION`, console rate limit 120/min, privilege note G11).**

- [ ] **Step 2: Point P2.4 at the implemented behavior; keep P2.5 as WP ask.**

- [ ] **Step 3: Run `npm run test:relay-unit` and `cd apps/workpet && npm run test:ui` and `node scripts/group-console-unit.js`**

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add docs/api-relay.md docs/NEXT-DEV-PATH.md
git commit -m "docs: freeze WorkPet group-console relay APIs"
```

---

## Self-review

| Spec section | Task |
|--------------|------|
| G1–G3 console + all façade groups | 4, 8 |
| G4 façade sender | 6 (unchanged sender) |
| G5 petName bubbles | 1, 5, 8 |
| G6 unknown `@` reject | 1, 6, 8 |
| G7 no `@` coordinator | 6 |
| G8 presence + isActive | 4 |
| G9 WP messages not ack log | 5, 8 |
| G10 ack `/v1/messages` | not removed |
| G11 privilege note | 9 |
| G12 / §8 WP pet identity | docs only, Task 9 P2.5 |
| Console rate limit | 4 |
| Mock `/messages` not shadowed | 2 |

No TBD. `formattedContent` vs stamp-on-delivery is decided in Task 6 (`payload.formatted`). Presence `userId` vs `member.id` handled in `memberOnline` via either field (spec: do not guess extra shapes).
