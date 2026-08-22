import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeRoot } from '../runtimeRoot.js';
import { authenticateRequest } from './authPet.js';
import { createHandlers } from './handlers.js';
import { openDb, getDbPath, closeDb } from './db.js';
import { syncConfigPets } from './registry.js';
import { syncConfigRunners } from './runners.js';
import { resumePending } from './delivery.js';
import { reclaimExpiredTasks } from './services/taskQueueService.js';
import { startHostJoin, stopHostJoin } from './hostJoin.js';
import { enforceRetention } from './retention.js';
import { logEvent } from './structuredLogger.js';
import { validateFederationClientConfig } from './federationClient.js';

export const ROOT = runtimeRoot(import.meta.url, 2);

export function loadRelayConfig(configPath) {
  const resolved = path.resolve(
    configPath ||
      process.env.CONNECTER_RELAY_CONFIG ||
      path.join(ROOT, 'config', 'relay.json')
  );
  if (!fs.existsSync(resolved)) {
    const example = path.join(ROOT, 'config', 'relay.example.json');
    throw new Error(
      `Relay config missing: ${resolved}\nCopy ${example} → ${resolved}`
    );
  }
  return { path: resolved, config: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function send(res, status, body) {
  const code = Number.isInteger(status) ? status : 500;
  const payload = body === undefined ? { error: 'empty handler body' } : body;
  const raw = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

function applyCors(req, res, config) {
  const configured = config.cors?.origins || config.cors?.allowedOrigins || ['*'];
  const origins = Array.isArray(configured) ? configured : [configured];
  const origin = req.headers.origin;
  const allowAll = origins.includes('*');
  if (!allowAll && (!origin || !origins.includes(origin))) return;

  res.setHeader(
    'access-control-allow-origin',
    allowAll ? origin || '*' : origin
  );
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'Authorization, Content-Type, Accept'
  );
  res.setHeader('access-control-max-age', '86400');
  if (origin) res.setHeader('vary', 'Origin');
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 262144) {
      const error = new Error('request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

export async function bootstrapRelay(options = {}) {
  const loaded = options.config
    ? { path: options.configPath || '(inline)', config: options.config }
    : loadRelayConfig(options.configPath);
  const { path: cfgPath, config } = loaded;

  const dbPath = options.dbPath || getDbPath(config, ROOT);
  if (config?.host?.role === 'connecter' || config?.host?.baseUrl) validateFederationClientConfig(config);
  openDb(dbPath);
  await syncConfigPets(config);
  await syncConfigRunners(config);
  await enforceRetention(config);
  if (options.resume !== false) {
    await reclaimExpiredTasks({ actor: 'startup' });
    await resumePending(config);
  }

  return { cfgPath, config, dbPath };
}

export function createRelayServer(options = {}) {
  // bootstrap must be awaited by caller first; allow sync create if already open
  const loaded = options.config
    ? { path: options.configPath || '(inline)', config: options.config }
    : loadRelayConfig(options.configPath);
  const { path: cfgPath, config } = loaded;
  const handlers = createHandlers({ config });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      applyCors(req, res, config);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (
        req.method === 'GET' &&
        (pathname === '/v1/health' || pathname === '/health')
      ) {
        const h = handlers.health();
        return send(res, h.status, h.body);
      }

      const hostOnly = config?.host?.role === 'host';
      const hostPath = pathname.startsWith('/v1/host/') || pathname.startsWith('/v1/federation/') || pathname.startsWith('/v1/ops/');
      if (hostOnly && !hostPath) {
        return send(res, 404, { error: 'not found', path: pathname });
      }

      if (req.method === 'POST' && pathname === '/v1/agents/register') {
        const body = await readJson(req);
        const h = await handlers.agentRegister(body);
        return send(res, h.status || 200, h.body || {});
      }

      if (req.method === 'POST' && pathname === '/v2/enrollments') {
        const body = await readJson(req);
        const h = await handlers.enrollmentCreate(body);
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/host/peers/register') {
        const body = await readJson(req);
        const h = await handlers.hostPeerRegister(body);
        return send(res, h.status || 200, h.body || {});
      }

      if (req.method === 'POST' && pathname === '/v1/auth/login') {
        const body = await readJson(req);
        const h = await handlers.login(body);
        return send(res, h.status || 200, h.body || {});
      }

      const consolePath =
        pathname === '/v1/groups' ||
        pathname.startsWith('/v1/groups/') ||
        pathname === '/v1/members';
      const auth = authenticateRequest(req, config, {
        rateBucket: consolePath ? 'console' : 'chat',
      });
      if (!auth.ok) {
        return send(res, auth.status || 401, { error: auth.error });
      }

      if (req.method === 'GET' && pathname === '/v1/envs') {
        const h = await handlers.envs();
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/backends/register') {
        const body = await readJson(req);
        const h = await handlers.backendRegister(auth, body);
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/backends/heartbeat') {
        const body = await readJson(req);
        const h = await handlers.backendHeartbeat(auth, body);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/instances') {
        const h = handlers.instances(auth);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/groups') {
        const h = await handlers.groups(auth, {
          env: url.searchParams.get('env'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/groups/')) {
        const parts = pathname.slice('/v1/groups/'.length).split('/').map((p) => {
          try {
            return decodeURIComponent(p);
          } catch {
            return p;
          }
        });
        if (parts.length === 2 && parts[0] && parts[1] === 'messages') {
          const h = await handlers.groupMessages(auth, parts[0], {
            env: url.searchParams.get('env'),
            limit: url.searchParams.get('limit'),
          });
          return send(res, h.status, h.body);
        }
        if (parts.length !== 1 || !parts[0]) {
          return send(res, 404, { error: 'not found', path: pathname });
        }
        const h = await handlers.group(auth, parts[0], {
          env: url.searchParams.get('env'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/chat') {
        const body = await readJson(req);
        const h = await handlers.chat(body, auth);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/members') {
        const h = await handlers.members(auth, {
          group: url.searchParams.get('group'),
          env: url.searchParams.get('env'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/messages') {
        const h = handlers.messages(auth, {
          since: url.searchParams.get('since'),
          group: url.searchParams.get('group'),
          env: url.searchParams.get('env'),
          agent: url.searchParams.get('agent'),
          limit: url.searchParams.get('limit'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/runs/')) {
        const id = decodeURIComponent(pathname.slice('/v1/runs/'.length));
        const h = handlers.runs(id);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/logs') {
        const h = handlers.logs(url.searchParams.get('limit'));
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/session/revoke') {
        const h = await handlers.revoke(auth);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/ops/health/detail') {
        const h = handlers.opsHealthDetail(auth);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname.startsWith('/v1/ops/traces/')) {
        const traceId = decodeURIComponent(pathname.slice('/v1/ops/traces/'.length));
        const h = handlers.opsTrace(auth, traceId);
        return send(res, h.status, h.body);
      }

      if (pathname === '/v1/ops/federation/policies') {
        const h = req.method === 'GET'
          ? handlers.opsPolicyList(auth, { status: url.searchParams.get('status'), limit: url.searchParams.get('limit') })
          : req.method === 'POST'
            ? await handlers.opsPolicyCreate(auth, await readJson(req))
            : { status: 405, body: { error: 'method not allowed' } };
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname.startsWith('/v1/ops/federation/policies/') && pathname.endsWith('/disable')) {
        const id = decodeURIComponent(pathname.slice('/v1/ops/federation/policies/'.length, -'/disable'.length).replace(/\/$/, ''));
        const h = await handlers.opsPolicyDisable(auth, id);
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/ops/federation/outbox') {
        const h = handlers.opsFederationOutbox(auth, { status: url.searchParams.get('status'), limit: url.searchParams.get('limit') });
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname.startsWith('/v1/ops/host/peers/')) {
        const rest = pathname.slice('/v1/ops/host/peers/'.length).split('/');
        if (rest.length === 2 && rest[0]) {
          const siteId = decodeURIComponent(rest[0]);
          const h = rest[1] === 'revoke'
            ? handlers.hostPeerRevoke(auth, siteId)
            : rest[1] === 'rotate'
              ? handlers.hostPeerRotate(auth, siteId, await readJson(req))
              : null;
          if (h) return send(res, h.status, h.body);
        }
      }

      if (req.method === 'GET' && pathname === '/v1/ops/security/deliveries') {
        const h = handlers.opsSecurityDeliveries(auth, {
          siteId: url.searchParams.get('siteId'), keyId: url.searchParams.get('keyId'),
          status: url.searchParams.get('status'), since: url.searchParams.get('since'),
          until: url.searchParams.get('until'), limit: url.searchParams.get('limit'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname.startsWith('/v1/ops/federation/outbox/') && pathname.endsWith('/requeue')) {
        const id = decodeURIComponent(pathname.slice('/v1/ops/federation/outbox/'.length, -'/requeue'.length).replace(/\/$/, ''));
        const h = await handlers.opsFederationOutboxRequeue(auth, id);
        return send(res, h.status, h.body);
      }

      if (req.method === 'POST' && pathname === '/v1/federation/messages') {
        const h = await handlers.federationAccept(auth, await readJson(req));
        return send(res, h.status, h.body);
      }
      if (req.method === 'POST' && pathname === '/v1/federation/pull') {
        const h = await handlers.federationPull(auth, await readJson(req));
        return send(res, h.status, h.body);
      }
      if (req.method === 'POST' && pathname === '/v1/federation/ack') {
        const h = await handlers.federationAck(auth, await readJson(req));
        return send(res, h.status, h.body);
      }
      if (req.method === 'POST' && pathname === '/v1/federation/result') {
        const h = await handlers.federationComplete(auth, await readJson(req));
        return send(res, h.status, h.body);
      }
      if (req.method === 'POST' && pathname === '/v1/federation/directory/advertise') {
        const h = await handlers.federationAdvertise(auth, await readJson(req));
        return send(res, h.status, h.body);
      }
      if (req.method === 'GET' && pathname === '/v1/federation/directory') {
        const h = handlers.federationDirectory(auth, { groupRef: url.searchParams.get('groupRef') });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/ops/tasks') {
        const h = handlers.opsTasks(auth, {
          status: url.searchParams.get('status'),
          runnerId: url.searchParams.get('runnerId'),
          limit: url.searchParams.get('limit'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v2/directory/subjects') {
        const h = handlers.directorySubjects(auth, {
          groupRef: url.searchParams.get('groupRef'),
          kind: url.searchParams.get('kind'),
          online: url.searchParams.get('online'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v2/directory/endpoints') {
        const h = handlers.directoryEndpoints(auth, {
          capability: url.searchParams.get('capability'),
          siteId: url.searchParams.get('siteId'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v2/routes/explain') {
        const h = handlers.routeExplain(auth, {
          traceId: url.searchParams.get('traceId'),
          groupRef: url.searchParams.get('groupRef'),
          targetSubjectId: url.searchParams.get('targetSubjectId'),
          agentName: url.searchParams.get('agentName'),
          sourceSiteId: url.searchParams.get('sourceSiteId') || config?.host?.siteId || config?.siteId || 'local',
          requiredCapabilities: url.searchParams.getAll('capability'),
        });
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v2/ops/enrollments') {
        const h = handlers.enrollmentList(auth, { status: url.searchParams.get('status') });
        return send(res, h.status, h.body);
      }

      if (pathname.startsWith('/v2/ops/enrollments/')) {
        const rest = pathname.slice('/v2/ops/enrollments/'.length).split('/');
        if (rest.length === 2 && req.method === 'POST') {
          const enrollmentId = decodeURIComponent(rest[0]);
          const body = await readJson(req);
          const h = rest[1] === 'approve'
            ? await handlers.enrollmentApprove(auth, enrollmentId, body)
            : rest[1] === 'reject'
              ? handlers.enrollmentReject(auth, enrollmentId)
              : null;
          if (h) return send(res, h.status, h.body);
        }
      }

      if (req.method === 'POST' && pathname === '/v2/credentials/rotate') {
        const h = await handlers.credentialRotate(auth);
        return send(res, h.status, h.body);
      }

      if (pathname.startsWith('/v2/ops/credentials/') && pathname.endsWith('/revoke') && req.method === 'POST') {
        const credentialId = decodeURIComponent(
          pathname.slice('/v2/ops/credentials/'.length, -'/revoke'.length).replace(/\/$/, '')
        );
        const h = handlers.credentialRevoke(auth, credentialId);
        return send(res, h.status, h.body);
      }

      if (pathname.startsWith('/v1/ops/tasks/')) {
        const rest = pathname.slice('/v1/ops/tasks/'.length).split('/');
        if (rest.length === 2 && rest[0]) {
          const taskId = decodeURIComponent(rest[0]);
          if (req.method === 'POST' && rest[1] === 'requeue') {
            const body = await readJson(req);
            const h = await handlers.opsTaskRequeue(auth, taskId, body);
            return send(res, h.status, h.body);
          }
          if (req.method === 'POST' && rest[1] === 'cancel') {
            const body = await readJson(req);
            const h = await handlers.opsTaskCancel(auth, taskId, body);
            return send(res, h.status, h.body);
          }
        }
      }


        if (req.method === 'POST' && pathname === '/v1/agents/heartbeat') {
          const body = await readJson(req);
          const h = handlers.agentHeartbeat(auth, body);
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/agents/tasks/result') {
          const body = await readJson(req);
          const h = await handlers.agentTaskResult(auth, body);
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/agents/tasks/ack') {
          const body = await readJson(req);
          const h = await handlers.agentTaskAck(auth, body);
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/agents/tasks/renew') {
          const body = await readJson(req);
          const h = await handlers.agentTaskRenew(auth, body);
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/agents/tasks') {
          const h = await handlers.agentTasks(auth, {
            limit: url.searchParams.get('limit'),
          });
          return send(res, h.status, h.body);
        }

        if (req.method === 'GET' && pathname === '/v1/agents') {
          const h = handlers.agentList(auth, {
            env: url.searchParams.get('env'),
            group: url.searchParams.get('group'),
          });
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/host/peers/heartbeat') {
          const h = handlers.hostPeerHeartbeat(auth);
          return send(res, h.status, h.body);
        }

        if (req.method === 'GET' && pathname === '/v1/host/peers') {
          const h = handlers.hostPeerList(auth);
          return send(res, h.status, h.body);
        }
      return send(res, 404, { error: 'not found', path: pathname });
    } catch (err) {
      return send(res, Number(err.status) || 500, { error: String(err.message || err) });
    }
  });

  return { server, config, cfgPath };
}

export async function listenRelay(options = {}) {
  const boot = await bootstrapRelay(options);
  const { server, config, cfgPath } = createRelayServer({
    ...options,
    config: boot.config,
    configPath: boot.cfgPath,
  });
  const host = process.env.CONNECTER_RELAY_HOST || config.listen?.host || '0.0.0.0';
  const port = Number(
    process.env.CONNECTER_RELAY_PORT || config.listen?.port || 80
  );

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const envs = Object.keys(config.backends || {}).join(',');
      const pets = (config.pets || []).length;
      const runners = (config.runners || []).length;
      const join = startHostJoin(config);
      server.on('close', () => {
        join.stop();
        stopHostJoin();
      });
      logEvent('info', 'relay.listening', {
        siteId: config?.host?.siteId || config?.siteId || null,
        role: config?.host?.role || 'standalone', host, port, configPath: cfgPath,
        backends: envs ? envs.split(',') : [], pets, runners, dbPath: boot.dbPath,
      });
      resolve({ server, port, host, config, cfgPath, dbPath: boot.dbPath, stopHostJoin: join.stop });
    });
  });
}

export { closeDb };
