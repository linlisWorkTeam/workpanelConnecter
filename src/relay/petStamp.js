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
