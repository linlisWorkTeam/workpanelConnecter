#!/usr/bin/env node
/**
 * Minimal local WorkPanel canary mock for Connecter Relay.
 * Usage: PORT=8081 node mock/workpanel-server.js
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 8081);
const groupId = process.env.GROUP_ID || 'local-group-1';
const groupName = process.env.GROUP_NAME || 'local-canary';
const coordinatorName = process.env.COORDINATOR_NAME || 'Cursor Agent';

const gateGroupId = process.env.GATE_GROUP_ID || '528b36ba-4769-4b4d-9fa8-51e2de132396';
const gateGroupName = process.env.GATE_GROUP_NAME || '\u7070\u5ea6\u6d4b\u8bd5';

const user = {
  id: 'user-local',
  kind: 'user',
  isActive: true,
  displayName: 'Local User',
};
const agent = {
  id: 'agent-local',
  kind: 'agent',
  isActive: true,
  displayName: coordinatorName,
};
const group = {
  id: groupId,
  name: groupName,
  adminMemberId: agent.id,
  ownerMemberId: user.id,
};
const gateGroup = {
  id: gateGroupId,
  name: gateGroupName,
  adminMemberId: agent.id,
  ownerMemberId: user.id,
};
const groups = [group, gateGroup];

/** Last successful POST /api/messages body (for unit assertions). */
let lastMessagesPost = null;

function groupState(target) {
  return { group: target, members: [user, agent] };
}

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && path === '/api/health') {
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && path === '/api/auth/login') {
    if (!body.username || !body.password) {
      return send(res, 401, { error: 'invalid credentials' });
    }
    return send(res, 200, { token: `mock-wp-token-${randomUUID()}` });
  }

  if (req.method === 'GET' && path === '/api/groups') {
    if (!req.headers.authorization) {
      return send(res, 401, { error: 'authorization required' });
    }
    return send(res, 200, groups);
  }

  if (req.method === 'GET' && path === '/api/presence') {
    return send(res, 200, { onlineUserIds: [user.id] });
  }

  const messagesMatch = path.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (req.method === 'GET' && messagesMatch) {
    const target = groups.find((g) => g.id === decodeURIComponent(messagesMatch[1]));
    if (!target) return send(res, 404, { error: 'group not found' });
    return send(res, 200, {
      messages: [
        {
          id: 'wp_hist_1',
          senderMemberId: user.id,
          senderDisplayName: user.displayName,
          senderKind: 'user',
          content: 'hello from group',
          mentionMemberIds: [],
          ts: Date.now(),
        },
        {
          id: 'wp_hist_2',
          senderMemberId: user.id,
          senderDisplayName: user.displayName,
          senderKind: 'user',
          content: '【WorkPet:林的Pet】\nhello stamped',
          mentionMemberIds: [],
          ts: Date.now(),
        },
      ],
    });
  }

  if (req.method === 'GET' && path.startsWith('/api/groups/')) {
    const rest = decodeURIComponent(path.slice('/api/groups/'.length));
    if (rest.includes('/')) return send(res, 404, { error: 'not found', path });
    const target = groups.find((g) => g.id === rest);
    if (!target) {
      return send(res, 404, { error: 'group not found' });
    }
    return send(res, 200, groupState(target));
  }

  if (req.method === 'POST' && path === '/api/messages') {
    if (
      !body.groupId ||
      !body.senderMemberId ||
      !body.content ||
      !Array.isArray(body.mentionMemberIds)
    ) {
      return send(res, 400, { error: 'invalid message payload' });
    }
    lastMessagesPost = body;
    return send(res, 200, {
      message: { id: `wp_msg_${randomUUID()}` },
      runIds: [`run_${randomUUID()}`],
    });
  }

  if (req.method === 'GET' && path === '/api/debug/last-messages-post') {
    return send(res, 200, { body: lastMessagesPost });
  }

  return send(res, 404, { error: 'not found', path });
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `local workpanel mock on http://127.0.0.1:${port} group=${group.name}`
  );
});
