/**
 * DTOs for GET /v1/groups* (WorkPet mini group console).
 */

import { parseAgentMention, stripPetStamp } from './petStamp.js';
import { extractMentionTarget, pickAdminAgent } from './mentions.js';

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
  if (member.kind === 'agent' || member.kind === 'chatbot') return member.isActive !== false;
  const ids = new Set(onlineUserIds || []);
  return ids.has(member.authUserId) || ids.has(member.id) || ids.has(member.userId);
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
    isActive: member.isActive !== false,
    online: memberOnline(member, onlineUserIds),
  };
}

export function coordinatorAgentName(members, defaults = {}) {
  const name = defaults.coordinatorAgentName;
  if (name && (members || []).some((m) => m.kind === 'agent' && m.isActive && m.displayName === name)) {
    return name;
  }
  const first = (members || []).find((m) => m.kind === 'agent' && m.isActive);
  return first?.displayName || name || null;
}

function mentionRest(prompt, name) {
  const text = String(prompt || '');
  const needle = `@${name}`;
  const at = text.indexOf(needle);
  if (at < 0) return text.trim();
  return `${text.slice(0, at)}${text.slice(at + needle.length)}`.trim();
}

export function resolveChatTarget({ prompt, members, group }) {
  const mention = extractMentionTarget(prompt, members);
  if (mention.hasAt) {
    if (!mention.target || mention.target.kind !== 'agent') {
      return {
        ok: false,
        agent: null,
        rest: String(prompt || ''),
        error: 'UNKNOWN_MENTION',
        code: 'UNKNOWN_MENTION',
        mention: mention.raw,
      };
    }
    const parsed = parseAgentMention(prompt, members);
    const rest = parsed.ok && parsed.agent ? parsed.rest : mentionRest(prompt, mention.target.displayName);
    return { ok: true, agent: mention.target, rest, mentioned: true };
  }
  const admin = pickAdminAgent(group, members);
  if (!admin) return { ok: false, code: 'NO_ADMIN', error: 'NO_ADMIN' };
  return { ok: true, agent: admin, rest: String(prompt || '').trim(), mentioned: false };
}
