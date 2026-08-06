import { randomUUID } from 'node:crypto';
import {
  db,
  writeTx,
  insertMessageOrGet,
  updateMessageStatus,
  insertDeliveryLog,
  upsertRun,
  listMessagesSince,
  getMessageById,
} from './db.js';

export function makeEnvelope({
  id,
  type = 'chat.text',
  direction,
  conversation,
  from,
  to,
  content,
  ack = 'accepted',
}) {
  return {
    id: id || `msg_${randomUUID()}`,
    type,
    direction,
    conversation: conversation.startsWith('grp_')
      ? conversation
      : `grp_${conversation}`,
    from,
    to,
    payload: { content },
    ts: Date.now(),
    ack,
  };
}

export async function acceptUpMessage({
  messageId,
  agentInstance,
  petId,
  content,
}) {
  const envelope = makeEnvelope({
    id: messageId || `msg_${randomUUID()}`,
    direction: 'up',
    conversation: agentInstance.group_id,
    from: { kind: 'pet', id: petId },
    to: { kind: 'agent', id: agentInstance.agent_name },
    content,
    ack: 'accepted',
  });

  return writeTx((database) => {
    const result = insertMessageOrGet(database, {
      id: envelope.id,
      agent_instance_id: agentInstance.id,
      direction: 'up',
      envelope_json: JSON.stringify(envelope),
      status: 'accepted',
      retries: 0,
    });
    return {
      inserted: result.inserted,
      message: result.row,
      envelope: JSON.parse(result.row.envelope_json),
    };
  });
}

export async function markDelivered(messageId, { runIds, wpMessageId, detail }) {
  return writeTx((database) => {
    updateMessageStatus(database, messageId, 'delivered', null);
    insertDeliveryLog(database, {
      message_id: messageId,
      target: 'workpanel',
      attempt: 0,
      result: 'delivered',
    });
    const msg = getMessageById(database, messageId);
    for (const rid of runIds || []) {
      upsertRun(database, {
        id: rid,
        message_id: messageId,
        agent_instance_id: msg.agent_instance_id,
        status: 'queued',
        detail_json: JSON.stringify({ wpMessageId, ...detail }),
      });
    }
    // Down echo for pet polling (N2)
    const upEnv = JSON.parse(msg.envelope_json);
    const down = makeEnvelope({
      id: `msg_${randomUUID()}`,
      direction: 'down',
      conversation: upEnv.conversation.replace(/^grp_/, ''),
      from: { kind: 'agent', id: upEnv.to.id },
      to: { kind: 'pet', id: upEnv.from.id },
      content: JSON.stringify({
        type: 'delivery.ack',
        upMessageId: messageId,
        status: 'delivered',
        runIds: runIds || [],
        wpMessageId,
      }),
      ack: 'delivered',
    });
    insertMessageOrGet(database, {
      id: down.id,
      agent_instance_id: msg.agent_instance_id,
      direction: 'down',
      envelope_json: JSON.stringify(down),
      status: 'delivered',
      retries: 0,
    });
    return { message: getMessageById(database, messageId), downId: down.id };
  });
}

export async function markFailed(messageId, error, retries) {
  return writeTx((database) => {
    const status = retries >= 3 ? 'failed' : 'accepted';
    updateMessageStatus(database, messageId, status, retries);
    insertDeliveryLog(database, {
      message_id: messageId,
      target: 'workpanel',
      attempt: retries,
      result: status === 'failed' ? `dead:${error}` : `retry:${error}`,
    });
    return getMessageById(database, messageId);
  });
}

export function pollMessages(agentInstanceId, since, limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = listMessagesSince(db(), agentInstanceId, since, lim);
  return rows.map((r) => ({
    seq: r.seq,
    id: r.id,
    direction: r.direction,
    status: r.status,
    envelope: JSON.parse(r.envelope_json),
    created_at: r.created_at,
  }));
}
