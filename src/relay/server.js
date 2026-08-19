import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateRequest } from './authPet.js';
import { createHandlers } from './handlers.js';
import { openDb, getDbPath, closeDb } from './db.js';
import { syncConfigPets } from './registry.js';
import { syncConfigRunners } from './runners.js';
import { resumePending } from './delivery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');

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
  const raw = JSON.stringify(body);
  res.writeHead(status, {
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
  for await (const c of req) chunks.push(c);
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
  openDb(dbPath);
  await syncConfigPets(config);
    await syncConfigRunners(config);
  if (options.resume !== false) {
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


        if (req.method === 'POST' && pathname === '/v1/agents/register') {
          const body = await readJson(req);
          const h = await handlers.agentRegister(body);
          return send(res, h.status || 200, h.body || {});
        }

      const auth = authenticateRequest(req, config);
      if (!auth.ok) {
        return send(res, auth.status || 401, { error: auth.error });
      }

      if (req.method === 'GET' && pathname === '/v1/envs') {
        const h = handlers.envs();
        return send(res, h.status, h.body);
      }

      if (req.method === 'GET' && pathname === '/v1/instances') {
        const h = handlers.instances(auth);
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


        if (req.method === 'POST' && pathname === '/v1/agents/heartbeat') {
          const h = handlers.agentHeartbeat(auth);
          return send(res, h.status, h.body);
        }

        if (req.method === 'POST' && pathname === '/v1/agents/tasks/result') {
          const body = await readJson(req);
          const h = await handlers.agentTaskResult(auth, body);
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
      return send(res, 404, { error: 'not found', path: pathname });
    } catch (err) {
      return send(res, 500, { error: String(err.message || err) });
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
      console.log(
        `connecter-relay listening http://${host}:${port} config=${cfgPath} backends=${envs} pets=${pets} db=${boot.dbPath}`
      );
      resolve({ server, port, host, config, cfgPath, dbPath: boot.dbPath });
    });
  });
}

export { closeDb };
