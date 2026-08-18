/**
 * DTOs for GET /v1/groups* (WorkPet mini group console).
 */

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

export function toGroupMember(member, onlineUserIds) {
  return {
    id: member.id,
    displayName: member.displayName,
    kind: member.kind,
    isActive: Boolean(member.isActive),
    online: memberOnline(member, onlineUserIds),
  };
}

export function coordinatorAgentName(members, defaults = {}) {
  const name = defaults.coordinatorAgentName;
  if (name && (members || []).some((m) => m.kind === 'agent' && m.displayName === name)) {
    return name;
  }
  const first = (members || []).find((m) => m.kind === 'agent' && m.isActive);
  return first?.displayName || name || null;
}
