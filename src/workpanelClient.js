/**
 * WorkPanel HTTP client (canary/prod slots).
 * Pet chat logs in as pets[].wpAuth (the human WP user). Facade backend.auth
 * is only the fallback when wpAuth is omitted.
 */

import { parseAgentMention, formatPetStamp } from './relay/petStamp.js';
import { pickAdminAgent } from './relay/mentions.js';
import { getSessionWpAuth } from './relay/sessionWpAuth.js';

const tokenCache = new Map(); // `${base}|${username}` -> { token, userId, username, expMs }

function baseOf(server) {
  return String(server.baseUrl || '').replace(/\/$/, '');
}

function authOf(server) {
  if (server.auth?.username) {
    return {
      username: server.auth.username,
      password: server.auth.password || '',
    };
  }
  return {
    username: process.env.CONNECTER_WP_USER || 'root',
    password: process.env.CONNECTER_WP_PASS || 'root',
  };
}

export function findPetConfig(config, petId) {
  if (!config || !petId) return null;
  return (config.pets || []).find((p) => p.id === petId) || null;
}

/** Overlay login / pets[].wpAuth onto a backend; WorkPet still only uses pet token. */
export function serverForPet(backend, config, petId) {
  const pet = findPetConfig(config, petId);
  const live = getSessionWpAuth(petId);
  let auth = backend?.auth || {};
  if (live?.username) {
    auth = { username: live.username, password: live.password || '' };
  } else if (pet?.wpAuth?.username) {
    auth = pet.wpAuth;
  } else if (pet?.wpUsername) {
    auth = { username: pet.wpUsername, password: pet.wpPassword || '' };
  }
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth,
  };
}

function loginCacheKey(base, username) {
  return `${base}|${username}`;
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

export async function wpSession(server, { timeoutMs = 5000, force = false } = {}) {
  const base = baseOf(server);
  const { username, password } = authOf(server);
  const key = loginCacheKey(base, username);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.expMs > Date.now()) return cached;

  const res = await fetchJson(`${base}/api/auth/login`, {
    method: 'POST',
    body: { username, password },
    timeoutMs,
  });
  if (!res.ok || !res.json?.token) {
    throw new Error(`wp login failed HTTP ${res.status}`);
  }
  const info = {
    token: res.json.token,
    userId: res.json.userId || res.json.user_id || null,
    username: res.json.username || username,
    expMs: Date.now() + 10 * 60 * 1000,
  };
  tokenCache.set(key, info);
  return info;
}

export async function wpLogin(server, { timeoutMs = 5000 } = {}) {
  const session = await wpSession(server, { timeoutMs });
  return session.token;
}

export async function wpPresenceHeartbeat(server, { timeoutMs = 4000 } = {}) {
  try {
    const session = await wpSession(server, { timeoutMs });
    const res = await fetchJson(`${baseOf(server)}/api/presence/heartbeat`, {
      method: 'POST',
      token: session.token,
      body: {},
      timeoutMs,
    });
    if (res.status === 404) return { ok: false, skipped: true };
    return {
      ok: res.ok,
      onlineUserIds: res.json?.onlineUserIds || [],
    };
  } catch {
    return { ok: false, skipped: true };
  }
}

export async function wpHealth(server, { timeoutMs = 3000 } = {}) {
  const base = baseOf(server);
  const res = await fetchJson(`${base}/api/health`, { timeoutMs });
  return res.ok && res.json?.ok !== false;
}

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

const LATEST_BEFORE_TS = 9999999999999;
const LATEST_BEFORE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

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

/** Latest page of group messages. WP requires beforeCreatedAt+beforeId (docs/WP-E2-COLLAB.md). */

export async function wpListGroupMessages(server, groupId, { limit = 50, timeoutMs = 10000 } = {}) {
  const token = await wpLogin(server, { timeoutMs });
  const q = new URLSearchParams({
    beforeCreatedAt: String(LATEST_BEFORE_TS),
    beforeId: LATEST_BEFORE_ID,
    limit: String(Math.min(100, Math.max(1, Number(limit) || 50))),
  });
  const res = await fetchJson(
    `${baseOf(server)}/api/groups/${encodeURIComponent(groupId)}/messages?${q}`,
    { token, timeoutMs }
  );
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      messages: [],
      error: res.json?.error || `wp messages HTTP ${res.status}`,
    };
  }
  const messages = Array.isArray(res.json?.messages) ? res.json.messages : [];
  return { ok: true, status: res.status, messages, error: null };
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

export async function wpGroupContext(server, team, { timeoutMs = 8000 } = {}) {
  const session = await wpSession(server, { timeoutMs });
  return wpResolveGroup(server, team, session.token);
}

function pickCoordinatorAgent(group, members, team) {
  const preferName = team.coordinatorAgentName;
  if (preferName) {
    return (
      members.find(
        (m) => m.kind === 'agent' && m.isActive !== false && m.displayName === preferName
      ) || null
    );
  }
  return pickAdminAgent(group, members);
}

function isActiveHuman(m) {
  return (m.kind === 'user' || m.kind === 'pet') && m.isActive !== false;
}

/**
 * Pet/user identity: member linked to the WP login (`authUserId`).
 * Legacy: unlinked group owner (canary 「我」 has null authUserId) — façade only.
 */
export function pickSender(group, members, { userId } = {}) {
  const list = members || [];
  if (userId) {
    const linked = list.find((m) => isActiveHuman(m) && m.authUserId === userId);
    if (linked) return linked;
  }
  const ownerId = group?.ownerMemberId;
  const owner = list.find((m) => m.id === ownerId);
  if (owner && isActiveHuman(owner) && !owner.authUserId) return owner;
  return null;
}

/**
 * Visibility: linked authUserId wins. If nobody in the group is bound yet,
 * trust the WP group list (canary 「我」 often has null authUserId).
 */
export function selfInGroup(_group, members, { userId } = {}) {
  const list = members || [];
  if (userId) {
    const linked = list.find((m) => isActiveHuman(m) && m.authUserId === userId);
    if (linked) return true;
  }
  const anyBound = list.some((m) => m.authUserId);
  if (!anyBound) return true;
  return false;
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
    const session = await wpSession(server, { timeoutMs });
    const { group, members } = await wpResolveGroup(server, team, session.token);
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

export function wpDispatchLoginTimeout(timeoutMs = 20000) {
  return Math.min(Math.max(Number(timeoutMs) || 20000, 1), 15000);
}

export async function dispatchWorkPanel(server, team, prompt, options = {}) {
  const { timeoutMs = 20000 } = options;
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
    const session = await wpSession(server, { timeoutMs: wpDispatchLoginTimeout(timeoutMs) });
    await wpPresenceHeartbeat(server, { timeoutMs: 3000 });
    const { group, members } = await wpResolveGroup(server, team, session.token);
    const coordinator = pickCoordinatorAgent(group, members, team);
    const sender = pickSender(group, members, { userId: session.userId });
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
        error: 'no sender user linked to wp login (set pets[].wpAuth or bind member authUserId)',
        body: null,
        taskId: null,
      };
    }

    const mentionName = options.mentionAgentName || team.coordinatorAgentName;
    const mention =
      (mentionName &&
        members.find((m) => m.kind === 'agent' && m.isActive && m.displayName === mentionName)) ||
      coordinator;
    if (!mention) {
      return {
        ok: false,
        status: 'failed',
        error: 'coordinator unavailable: no agent in group',
        body: null,
        taskId: null,
      };
    }

    let content;
    if (options.formattedContent) {
      content = String(options.formattedContent);
    } else if (options.petName) {
      const parsed = parseAgentMention(prompt, members);
      const rest = parsed.ok && parsed.agent ? parsed.rest : String(prompt || '').trim();
      content = `@${mention.displayName}\n${formatPetStamp(options.petName)}\n${rest}`.trim();
    } else {
      content = `@${mention.displayName} 【Connecter 调度】\n${prompt}`;
    }

    const res = await fetchJson(`${baseOf(server)}/api/messages`, {
      method: 'POST',
      token: session.token,
      timeoutMs,
      body: {
        groupId: group.id,
        senderMemberId: sender.id,
        content,
        mentionMemberIds: [mention.id],
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
        mentionedAgent: mention.displayName,
        senderMemberId: sender.id,
        senderDisplayName: sender.displayName,
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
    body: { groupId, senderMemberId: memberId, content, mentionMemberIds: [] },
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
