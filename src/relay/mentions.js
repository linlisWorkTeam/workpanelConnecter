/**
 * Pet chat targeting: only "@" vs no "@".
 * No "@" → group admin agent (if configured). "@Name" → that member (must be an agent).
 */
export function extractMentionTarget(prompt, members = []) {
  const names = [...new Set((members || []).map((m) => m.displayName).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  const text = String(prompt || '');
  let at = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const prev = i === 0 ? '' : text[i - 1];
    if (i > 0 && !/\s/.test(prev)) continue;
    at = i;
    break;
  }
  if (at < 0) return { hasAt: false, target: null, raw: null };

  const rest = text.slice(at + 1);
  for (const name of names) {
    if (!rest.startsWith(name)) continue;
    const next = rest.charAt(name.length);
    if (next && !/[\s,，、:：]/.test(next)) continue;
    const member = members.find((m) => m.displayName === name);
    return { hasAt: true, target: member || null, raw: name };
  }
  const raw = rest.split(/\s/)[0] || '';
  return { hasAt: true, target: null, raw };
}

/** Admin = group.adminMemberId if that member is an active agent. No "any agent" fallback. */
export function pickAdminAgent(group, members) {
  const adminId = group?.adminMemberId;
  if (!adminId) return null;
  const admin = (members || []).find((m) => m.id === adminId);
  if (admin && admin.kind === 'agent' && admin.isActive !== false) return admin;
  return null;
}
