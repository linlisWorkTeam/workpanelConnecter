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

/**
 * True when a members/messages fetch result must not be applied
 * (group switched or panel collapsed while awaiting).
 */
export function isStaleGroupFetch(requestedId, currentId, panelOpen) {
  if (!panelOpen) return true;
  if (!requestedId || !currentId) return true;
  return requestedId !== currentId;
}
