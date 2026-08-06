#!/usr/bin/env node
/**
 * Minimal mock Team Coordinator for local Connecter MVP.
 * Usage: PORT=19001 node mock/coordinator-server.js
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 19001);
const teamId = process.env.TEAM_ID || 'team-a';
const teamName = process.env.TEAM_NAME || 'group-a';

const agentCard = {
  name: `coordinator-${teamId}`,
  description: 'Non-AI Team Coordinator (mock)',
  protocol: 'A2A-compatible-mock',
  team_metadata: {
    capabilities: ['echo-dispatch'],
    members: [{ id: 'worker-1', role: 'worker' }],
    sla: { timeoutSec: 30 },
    permissionBoundary: 'mock-only',
    teamId,
    teamName,
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  if (req.method === 'GET' && (path === '/coordinator/health' || path === '/health')) {
    return send(200, { ok: true });
  }
  if (req.method === 'GET' && (path === '/coordinator/agent-card' || path === '/agent-card')) {
    return send(200, agentCard);
  }
  if (req.method === 'POST' && (path === '/coordinator/tasks' || path === '/tasks')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return send(400, { error: 'invalid json' });
    }
    const taskId = randomUUID();
    // Aggregate "team result" — mock non-AI coordinator
    return send(200, {
      taskId,
      status: 'succeeded',
      result: {
        echo: payload.prompt,
        via: 'mock-coordinator',
        teamId,
      },
    });
  }

  send(404, { error: 'not found', path });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock coordinator on http://127.0.0.1:${port} team=${teamId}`);
});
