#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  mergeBackendMap,
  listMergedEnvs,
  isSlotFresh,
  upsertWpSlot,
  backendsFor,
  probeWpHealth,
  annotateAlive,
} from '../src/relay/wpSlots.js';
import { openDb, closeDb } from '../src/relay/db.js';
import { createHandlers } from '../src/relay/handlers.js';
import { listEnvs } from '../src/relay/router.js';

const staticBackends = {
  canary: {
    baseUrl: 'http://127.0.0.1:8081',
    kind: 'workpanel',
    auth: { username: 'root', password: 'root' },
  },
  remote: { baseUrl: 'http://example.test', kind: 'workpanel' },
};

{
  const merged = mergeBackendMap(staticBackends, []);
  assert.equal(merged.canary.baseUrl, 'http://127.0.0.1:8081');
  assert.equal(merged.canary.source, 'config');
}

{
  const merged = mergeBackendMap(staticBackends, [
    {
      name: 'canary',
      baseUrl: 'http://127.0.0.1:8082',
      kind: 'workpanel',
      fresh: true,
    },
  ]);
  assert.equal(merged.canary.baseUrl, 'http://127.0.0.1:8082');
  assert.equal(merged.canary.source, 'register');
  assert.deepEqual(merged.canary.auth, { username: 'root', password: 'root' });
}

{
  const merged = mergeBackendMap(staticBackends, [
    { name: 'canary', baseUrl: 'http://127.0.0.1:8082', fresh: false },
  ]);
  assert.equal(merged.canary.baseUrl, 'http://127.0.0.1:8081');
  assert.equal(merged.canary.source, 'config');
}

{
  const merged = mergeBackendMap(staticBackends, [
    { name: 'lab', baseUrl: 'http://127.0.0.1:8099', kind: 'workpanel', fresh: true },
  ]);
  assert.equal(merged.lab.baseUrl, 'http://127.0.0.1:8099');
  assert.equal(merged.lab.source, 'register');
}

{
  const envs = listMergedEnvs(staticBackends, []);
  assert.deepEqual(
    envs.map((e) => e.name).sort(),
    ['canary', 'remote']
  );
  assert.equal(envs.find((e) => e.name === 'canary').baseUrl.includes('8081'), true);
  assert.equal('auth' in envs.find((e) => e.name === 'canary'), false);
}

assert.equal(isSlotFresh({ lastSeenAtMs: Date.now() }, 90), true);
assert.equal(isSlotFresh({ lastSeenAtMs: Date.now() - 120_000 }, 90), false);
assert.equal(isSlotFresh({}, 90), false);

console.log('WP_SLOTS_UNIT_OK merge');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-slots-'));
openDb(path.join(tmp, 'connector.db'));
try {
  await upsertWpSlot({
    name: 'canary',
    baseUrl: 'http://127.0.0.1:8082',
    auth: { username: 'lin', password: 'x' },
  });
  const cfg = { backends: staticBackends, wpSlotHeartbeatTtlSec: 90 };
  const merged = backendsFor(cfg);
  assert.equal(merged.canary.baseUrl, 'http://127.0.0.1:8082');
  assert.equal(merged.canary.source, 'register');
  assert.equal(merged.canary.auth.username, 'lin');
  assert.equal(listEnvs(cfg).find((e) => e.name === 'canary').source, 'register');
  const lan = listEnvs({
    backends: { office: { label: '办公室', baseUrl: 'http://192.168.1.10:8081', kind: 'workpanel' } },
  });
  assert.equal(lan.find((e) => e.name === 'office').label, '办公室');

  const petDenied = await createHandlers({ config: cfg }).backendRegister(
    { kind: 'pet', petId: 'p1' },
    { name: 'canary', baseUrl: 'http://127.0.0.1:8082' }
  );
  assert.equal(petDenied.status, 403);

  const prodDenied = await createHandlers({ config: cfg }).backendRegister(
    { kind: 'ops' },
    { name: 'prod', baseUrl: 'http://127.0.0.1:8080' }
  );
  assert.equal(prodDenied.status, 403);
} finally {
  closeDb();
}

{
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'linlis-work-panel' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    assert.equal(await probeWpHealth(`http://127.0.0.1:${port}`), true);
    assert.equal(await probeWpHealth('http://127.0.0.1:1'), false);
    const annotated = await annotateAlive([{ name: 'canary', baseUrl: `http://127.0.0.1:${port}` }]);
    assert.equal(annotated[0].alive, true);
  } finally {
    srv.close();
  }
}

console.log('WP_SLOTS_UNIT_OK register+health');

