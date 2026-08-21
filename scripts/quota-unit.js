import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, db } from '../src/relay/db.js';
import { checkFederationQuota, resetQuotaWindowsForTest } from '../src/relay/quotas.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-quota-'));
const dbPath = path.join(root, 'quota.db');
openDb(dbPath);
try {
  resetQuotaWindowsForTest();
  const config = { db: { path: dbPath }, federation: { quotas: { requestsPerMinute: 2, maxInflight: 1, maxQueueBytes: 1048576, maxDeadLetters: 1 } } };
  assert.equal(checkFederationQuota(config, 'site-a').allowed, true);
  assert.equal(checkFederationQuota(config, 'site-a').allowed, true);
  assert.equal(checkFederationQuota(config, 'site-a').reason, 'SITE_RATE_LIMIT');
  resetQuotaWindowsForTest();
  assert.equal(checkFederationQuota(config, 'target-a', 0, { requestSiteId: 'origin-a' }).allowed, true);
  assert.equal(checkFederationQuota(config, 'target-b', 0, { requestSiteId: 'origin-a' }).allowed, true);
  assert.equal(checkFederationQuota(config, 'target-c', 0, { requestSiteId: 'origin-a' }).reason, 'SITE_RATE_LIMIT',
    'one origin cannot bypass its rate quota by changing target Site');

  const insertMessage = db().prepare(
    `INSERT INTO federation_messages
     (id,origin_site,message_id,target_site,group_ref,kind,envelope_json,state,expires_at)
     VALUES (?, 'origin', ?, ?, 'wp:origin:group', 'chat.command', ?, 'accepted', datetime('now','+1 hour'))`
  );
  const insertDelivery = db().prepare(
    `INSERT INTO federation_deliveries (id,federation_id,target_site,status) VALUES (?, ?, ?, ?)`
  );

  resetQuotaWindowsForTest();
  insertMessage.run('fed-inflight', 'msg-inflight', 'site-inflight', '{}');
  insertDelivery.run('delivery-inflight', 'fed-inflight', 'site-inflight', 'queued');
  assert.equal(checkFederationQuota(config, 'site-inflight').reason, 'SITE_INFLIGHT_LIMIT');

  resetQuotaWindowsForTest();
  const largeEnvelope = JSON.stringify({ payload: 'x'.repeat(1048576) });
  insertMessage.run('fed-bytes', 'msg-bytes', 'site-bytes', largeEnvelope);
  insertDelivery.run('delivery-bytes', 'fed-bytes', 'site-bytes', 'queued');
  const byteConfig = { ...config, federation: { quotas: { ...config.federation.quotas, maxInflight: 2 } } };
  assert.equal(checkFederationQuota(byteConfig, 'site-bytes', 1).reason, 'SITE_QUEUE_BYTES_LIMIT');

  resetQuotaWindowsForTest();
  insertMessage.run('fed-dead', 'msg-dead', 'site-dead', '{}');
  insertDelivery.run('delivery-dead', 'fed-dead', 'site-dead', 'dead');
  assert.equal(checkFederationQuota(config, 'site-dead').reason, 'SITE_DEAD_LETTER_LIMIT');

  resetQuotaWindowsForTest();
  const diskPressureConfig = { ...config, federation: { quotas: { ...config.federation.quotas,
    requestsPerMinute: 100, maxInflight: 100, maxDeadLetters: 100, minFreeBytes: Number.MAX_SAFE_INTEGER } } };
  const diskPressure = checkFederationQuota(diskPressureConfig, 'site-disk');
  assert.equal(diskPressure.status, 507);
  assert.equal(diskPressure.reason, 'DISK_PRESSURE');
  console.log('QUOTA_UNIT_OK');
} finally { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
