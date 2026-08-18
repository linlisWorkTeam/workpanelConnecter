/**
 * DTOs for GET /v1/groups* (WorkPet mini group console).
 */

import { parseAgentMention, stripPetStamp } from './petStamp.js';

export function mapWpMessage(row) {
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
