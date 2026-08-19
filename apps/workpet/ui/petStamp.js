/** Client-side WorkPet stamp + @ autocomplete helpers (UI copy; do not import relay). */

const STAMP_RE = /^【WorkPet:([^】]{1,32})】\s*/m;

export function stripPetStamp(content) {
  const raw = String(content || '');
  const match = raw.match(STAMP_RE);
  if (!match) return { petDisplayName: null, contentDisplay: raw };
  return {
    petDisplayName: match[1],
    contentDisplay: raw.replace(STAMP_RE, '').trim(),
  };
}

/** Strip a leading `@Agent` line (WP transcript) and any pet stamp. */
function transcriptBody(text) {
  let s = stripPetStamp(String(text || '')).contentDisplay.trim();
  if (s.startsWith('@')) {
    const nl = s.indexOf('\n');
    if (nl !== -1) s = s.slice(nl + 1).trim();
  }
  return stripPetStamp(s).contentDisplay.trim();
}

function leadingMentionName(text) {
  const s = stripPetStamp(String(text || '')).contentDisplay.trim();
  if (!s.startsWith('@')) return '';
  const nl = s.indexOf('\n');
  if (nl === -1) return '';
  return s.slice(1, nl).trim();
}

function stripMentionToken(text, name) {
  if (!name) return String(text || '').trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text || '')
    .replace(new RegExp(`@${escaped}\\s*`, 'g'), '')
    .trim();
}

/**
 * True when a local optimistic composer bubble is the same user message
 * as a WP transcript row (`contentDisplay` is typically `@Agent\n{rest}`).
 */
export function matchesOptimisticBubble(pendingText, msg) {
  const pending = String(pendingText || '').trim();
  if (!pending) return false;
  const raw =
    msg?.contentDisplay != null
      ? String(msg.contentDisplay)
      : stripPetStamp(msg?.content || '').contentDisplay;
  const display = String(raw || '').trim();
  if (pending === display) return true;
  const source = display || String(msg?.content || '');
  const msgBody = transcriptBody(source);
  if (pending === msgBody) return true;
  if (transcriptBody(pending) === msgBody && msgBody !== '') return true;
  const name = leadingMentionName(source);
  return Boolean(name) && stripMentionToken(pending, name) === msgBody;
}

/**
 * Longest agent displayName that the typed prefix can complete toward
 * (displayName starts with typed text).
 */
export function matchAgentPrefix(typed, agents) {
  const prefix = String(typed || '');
  const list = (agents || []).filter((m) => m && m.kind === 'agent' && m.displayName);
  return list
    .slice()
    .sort((a, b) => b.displayName.length - a.displayName.length)
    .find((m) => m.displayName.startsWith(prefix)) || null;
}

/** Prefer WorkPet stamp display name; otherwise sender label. */
export function renderMessageAuthor(msg, petName) {
  if (msg?.petDisplayName) return String(msg.petDisplayName);
  if (msg?.senderDisplayName) return String(msg.senderDisplayName);
  return petName ? String(petName) : '';
}

/** Whether expand() should start console polling after await loadGroups(). */
export function shouldStartConsolePolling({ panelOpen, consolePaused }) {
  return Boolean(panelOpen) && !consolePaused;
}

export const XIAOAI_DONE_STATUSES = ['completed', 'failed', 'error', 'delivered'];

export function isXiaoaiDoneStatus(status) {
  return XIAOAI_DONE_STATUSES.includes(String(status || ''));
}

export function shouldAnnounceRun(prevStatus, nextStatus) {
  return !isXiaoaiDoneStatus(prevStatus) && isXiaoaiDoneStatus(nextStatus);
}

function spokenStatus(status) {
  const s = String(status || '');
  if (s === 'completed' || s === 'delivered') return '已完成';
  if (s === 'failed' || s === 'error') return '失败';
  return s || '已结束';
}

function stripForSpeech(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/[#*`>|]+/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function formatXiaoaiAnnounce({ petName, agent, status, lastAgentText } = {}) {
  const name = String(petName || 'WorkPet').trim() || 'WorkPet';
  const who = String(agent || 'Agent').trim() || 'Agent';
  const prefix = `${name}，${who} ${spokenStatus(status)}。`;
  const extra = stripForSpeech(lastAgentText);
  if (!extra) return prefix.slice(0, 80);
  const room = 80 - prefix.length;
  if (room <= 1) return prefix.slice(0, 80);
  const body = extra.length <= room ? extra : extra.slice(0, Math.max(0, room - 1)).trimEnd();
  return `${prefix}${body}`.slice(0, 80);
}

/**
 * True when a members/messages fetch result must not be applied
 * (group switched or panel collapsed while awaiting).
 */
export function isStaleGroupFetch(requestedId, currentId, panelOpen) {
  if (!panelOpen) return true;
  if (!requestedId || !currentId) return true;
  return requestedId !== currentId;
}

const ENV_LABELS = { canary: '本地', remote: '远端', prod: '生产' };

/** CONNECTED SPACE 服务器下拉显示名：canary=本地，remote=远端。 */
export function envDisplayName(name) {
  const key = String(name || '').trim();
  return ENV_LABELS[key] || key || '服务器';
}

export function envHostLabel(baseUrl) {
  try {
    const u = new URL(String(baseUrl || ''));
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return '';
  }
}

export function envOptionLabel(row) {
  const name = envDisplayName(row?.name);
  const host = envHostLabel(row?.baseUrl);
  return host ? `${name} · ${host}` : name;
}

/** Pet 控制台不展示 prod（allowProdFromPet 默认关）。 */
export function petSelectableEnvs(envs) {
  return (envs || []).filter((row) => row && row.name && row.name !== 'prod');
}
