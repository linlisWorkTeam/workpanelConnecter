/**
 * WorkPanel HTTP client (canary/prod slots).
 * Connecter talks to WP as the "coordinator façade": health + group card + @mention dispatch.
 * Never bypass to invent worker URLs — only WP group APIs.
 */

const tokenCache = new Map(); // baseUrl -> { token, expMs }

function baseOf(server) {
  return String(server.baseUrl || '').replace(/\/$/, '');
}

function authOf(server) {
  return {
    username: process.env.CONNECTER_WP_USER || server.auth?.username || 'root',
    password: process.env.CONNECTER_WP_PASS || server.auth?.password || 'root',
  };
}

async function fetchJson(url, { method = 'GET', token, body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function wpLogin(server, { timeoutMs = 5000 } = {}) {
  const base = baseOf(server);
  const cached = tokenCache.get(base);
  if (cached && cached.expMs > Date.now()) return cached.token;

  const { username, password } = authOf(server);
  const res = await fetchJson(`${base}/api/auth/login`, {
    method: 'POST',
    body: { username, password },
    timeoutMs,
  });
  if (!res.ok || !res.json?.token) {
    throw new Error(`wp login failed HTTP ${res.status}`);
  }
  // JWT exp unknown here — cache 10 minutes
  tokenCache.set(base, { token: res.json.token, expMs: Date.now() + 10 * 60 * 1000 });
  return res.json.token;
}

export async function wpHealth(server, { timeoutMs = 3000 } = {}) {
  const base = baseOf(server);
  const res = await fetchJson(`${base}/api/health`, { timeoutMs });
  return res.ok && res.json?.ok !== false;
}

export async function wpResolveGroup(server, team, token) {
  const base = baseOf(server);
  const groupsRes = await fetchJson(`${base}/api/groups`, { token });
  if (!groupsRes.ok || !Array.isArray(groupsRes.json)) {
    throw new Error(`wp list groups failed HTTP ${groupsRes.status}`);
  }
  const keyId = String(team.id || '');
  const keyName = String(team.name || '');
  const group =
    groupsRes.json.find((g) => g.id === keyId) ||
    groupsRes.json.find((g) => g.name === keyName) ||
    null;
  if (!group) {
    throw new Error(`wp group not found: ${keyName || keyId}`);
  }
  const stateRes = await fetchJson(`${base}/api/groups/${group.id}`, { token });
  if (!stateRes.ok) {
    throw new Error(`wp group state failed HTTP ${stateRes.status}`);
  }
  const state = stateRes.json || {};
  const members = state.members || [];
  const g = state.group || group;
  return { group: g, members };
}

function pickCoordinatorAgent(group, members, team) {
  const preferName = team.coordinatorAgentName;
  if (preferName) {
    const hit = members.find(
      (m) => m.kind === 'agent' && m.isActive && m.displayName === preferName
    );
    if (hit) return hit;
  }
  const adminId = group.adminMemberId;
  const admin = members.find((m) => m.id === adminId);
  if (admin && admin.kind === 'agent' && admin.isActive) return admin;
  return members.find((m) => m.kind === 'agent' && m.isActive) || null;
}

function pickSender(group, members) {
  const ownerId = group.ownerMemberId;
  const owner = members.find((m) => m.id === ownerId);
  if (owner && owner.kind === 'user' && owner.isActive) return owner;
  return members.find((m) => m.kind === 'user' && m.isActive) || null;
}

export function buildTeamCard(group, members, coordinator) {
  const agents = members.filter((m) => m.kind === 'agent' && m.isActive);
  return {
    name: `wp-coordinator:${group.name}`,
    description: 'WorkPanel group façade (admin/agent as coordinator)',
    protocol: 'workpanel-group-a2a',
    team_metadata: {
      groupId: group.id,
      groupName: group.name,
      coordinatorAgentId: coordinator?.id || null,
      coordinatorAgentName: coordinator?.displayName || null,
      members: agents.map((a) => ({
        id: a.id,
        name: a.displayName,
        role: a.id === group.adminMemberId ? 'admin' : 'agent',
      })),
      sla: { note: 'dispatch returns after message accept; agent run is async' },
      permissionBoundary: 'canary-or-configured-slot-only',
    },
  };
}

export async function probeWorkPanel(server, team, { timeoutMs = 5000 } = {}) {
  try {
    const healthy = await wpHealth(server, { timeoutMs });
    if (!healthy) return { ok: false, error: 'wp /api/health failed', card: null };
    const token = await wpLogin(server, { timeoutMs });
    const { group, members } = await wpResolveGroup(server, team, token);
    const coordinator = pickCoordinatorAgent(group, members, team);
    if (!coordinator) {
      return { ok: false, error: 'no active agent coordinator in group', card: null };
    }
    const card = buildTeamCard(group, members, coordinator);
    return { ok: true, error: null, card };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'timeout' : String(err.message || err),
      card: null,
    };
  }
}

export async function dispatchWorkPanel(server, team, prompt, { timeoutMs = 20000 } = {}) {
  try {
    const healthy = await wpHealth(server, { timeoutMs: Math.min(timeoutMs, 5000) });
    if (!healthy) {
      return {
        ok: false,
        status: 'failed',
        error: 'coordinator unavailable: wp health failed',
        body: null,
        taskId: null,
      };
    }
    const token = await wpLogin(server, { timeoutMs: Math.min(timeoutMs, 5000) });
    const { group, members } = await wpResolveGroup(server, team, token);
    const coordinator = pickCoordinatorAgent(group, members, team);
    const sender = pickSender(group, members);
    if (!coordinator) {
      return {
        ok: false,
        status: 'failed',
        error: 'coordinator unavailable: no agent in group',
        body: null,
        taskId: null,
      };
    }
    if (!sender) {
      return {
        ok: false,
        status: 'failed',
        error: 'no sender user in group',
        body: null,
        taskId: null,
      };
    }

    const content = `@${coordinator.displayName} 【Connecter 调度】\n${prompt}`;
    const res = await fetchJson(`${baseOf(server)}/api/messages`, {
      method: 'POST',
      token,
      timeoutMs,
      body: {
        groupId: group.id,
        senderMemberId: sender.id,
        content,
        mentionMemberIds: [coordinator.id],
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        status: 'failed',
        error: `coordinator HTTP ${res.status}`,
        body: res.json,
        taskId: null,
      };
    }

    const msg = res.json?.message || res.json || {};
    const taskId = msg.id || res.json?.runIds?.[0] || null;
    return {
      ok: true,
      status: 'accepted',
      error: null,
      body: {
        messageId: msg.id,
        runIds: res.json?.runIds || [],
        groupId: group.id,
        groupName: group.name,
        coordinatorAgent: coordinator.displayName,
        via: 'workpanel-api-messages',
      },
      taskId,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      error:
        err.name === 'AbortError'
          ? 'coordinator timeout/unreachable'
          : `coordinator unavailable: ${err.message || err}`,
      body: null,
      taskId: null,
    };
  }
}

export function isWorkPanelServer(server) {
  return server?.kind === 'workpanel' || server?.protocol === 'workpanel';
}

/**
 * E2: post a message INTO a WorkPanel group thread AS the named agent member.
 * Best-effort write-back for runner results (sender = the agent itself).
 */
export async function postAsAgent(server, { groupId, agentName, content, timeoutMs = 15000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  let memberId = null;
  if (groupId && agentName) {
    const stateRes = await fetchJson(`${baseOf(server)}/api/groups/${groupId}`, { token, timeoutMs });
    if (stateRes.ok && Array.isArray(stateRes.json?.members)) {
      const hit = stateRes.json.members.find(
        (m) => m.kind === 'agent' && m.isActive && m.displayName === agentName
      );
      memberId = hit?.id || null;
    }
  }
  if (!memberId) {
    return { ok: false, status: 400, error: `agent member not found: ${agentName || groupId}` };
  }
  const res = await fetchJson(`${baseOf(server)}/api/messages`, {
    method: 'POST',
    token,
    timeoutMs,
    body: { groupId, senderMemberId: memberId, content },
  });
  return { ok: res.ok, status: res.status, body: res.json };
}

/**
 * Unwrap WP agent JSON parts (`{"v":1,"parts":[{"channel":"final","text":"..."}]}`) or return raw.
 */
export function extractWpMessageText(content) {
  if (content == null) return '';
  if (typeof content !== 'string') return JSON.stringify(content);
  try {
    const j = JSON.parse(content);
    if (j && Array.isArray(j.parts)) {
      const finals = j.parts.filter((p) => p.channel === 'final' && p.text).map((p) => p.text);
      if (finals.length) return finals.join('\n');
      const texts = j.parts.map((p) => p.text).filter(Boolean);
      if (texts.length) return texts.join('\n');
    }
  } catch {
    /* plain text */
  }
  return content;
}

const LATEST_BEFORE_TS = 9999999999999;
const LATEST_BEFORE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** Latest page of group messages. WP requires beforeCreatedAt+beforeId (docs/WP-E2-COLLAB.md). */
export async function wpListGroupMessages(server, groupId, { limit = 30, timeoutMs = 10000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  const q = new URLSearchParams({
    beforeCreatedAt: String(LATEST_BEFORE_TS),
    beforeId: LATEST_BEFORE_ID,
    limit: String(Math.min(Math.max(Number(limit) || 30, 1), 100)),
  });
  const res = await fetchJson(`${baseOf(server)}/api/groups/${groupId}/messages?${q}`, {
    token,
    timeoutMs,
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.json?.error || `HTTP ${res.status}`, messages: [] };
  }
  const messages = res.json?.messages || [];
  return { ok: true, status: res.status, messages };
}
