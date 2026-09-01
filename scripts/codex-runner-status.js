#!/usr/bin/env node
/** Print redacted local Relay/Codex Runner status using the ignored ops token. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const configPath = process.env.CONNECTER_RELAY_CONFIG || arg('--config', path.join(ROOT, 'config', 'relay.json'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = config.auth?.tokens?.[0];
  if (!token) throw new Error('ops token is required in the ignored relay config');
  const baseUrl = String(arg('--relay', `http://127.0.0.1:${config.listen?.port || 9080}`)).replace(/\/+$/, '');
  const get = async (pathname) => {
    const response = await fetch(`${baseUrl}${pathname}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const [health, detail, agents, endpoints] = await Promise.all([
    get('/v1/health'),
    get('/v1/ops/health/detail'),
    get('/v1/agents'),
    get('/v2/directory/endpoints'),
  ]);
  console.log(JSON.stringify({
    relay: baseUrl,
    health,
    host: detail.body?.host || null,
    agents: (agents.body?.agents || []).map((agent) => ({
      agentId: agent.agent_id || agent.runner_id || agent.id,
      agentName: agent.agent_name,
      env: agent.env,
      groupId: agent.group_id,
      status: agent.status || agent.runner_status,
      lastSeenAt: agent.last_seen_at,
    })),
    endpoints: (endpoints.body?.endpoints || []).map((endpoint) => ({
      endpointId: endpoint.endpointId || endpoint.endpoint_id,
      subjectId: endpoint.subjectId || endpoint.subject_id,
      runtime: endpoint.runtime,
      status: endpoint.status,
      online: endpoint.online,
      capabilities: endpoint.capabilities,
    })),
    credentials: 'not printed',
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
