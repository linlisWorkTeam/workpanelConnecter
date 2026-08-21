import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

const windows = new Map();

export function checkFederationQuota(config, siteId, payloadBytes = 0, { requestSiteId = siteId } = {}) {
  const quota = config?.federation?.quotas || {};
  const now = Date.now();
  const key = String(requestSiteId);
  const prior = windows.get(key);
  const window = !prior || now - prior.started >= 60000 ? { started: now, count: 0 } : prior;
  window.count += 1;
  windows.set(key, window);
  const rate = Math.min(Math.max(Number(quota.requestsPerMinute) || 600, 1), 100000);
  if (window.count > rate) return { allowed: false, status: 429, reason: 'SITE_RATE_LIMIT' };
  const inflight = db().prepare(`SELECT COUNT(*) n FROM federation_deliveries WHERE target_site=? AND status IN ('queued','leased','acknowledged')`).get(siteId).n;
  if (inflight >= Math.min(Math.max(Number(quota.maxInflight) || 10000, 1), 1000000)) return { allowed: false, status: 429, reason: 'SITE_INFLIGHT_LIMIT' };
  const bytes = db().prepare(`SELECT COALESCE(SUM(length(m.envelope_json)),0) n FROM federation_deliveries d JOIN federation_messages m ON m.id=d.federation_id WHERE d.target_site=? AND d.status IN ('queued','leased','acknowledged')`).get(siteId).n;
  if (bytes + payloadBytes > Math.min(Math.max(Number(quota.maxQueueBytes) || 134217728, 1048576), 1073741824)) return { allowed: false, status: 429, reason: 'SITE_QUEUE_BYTES_LIMIT' };
  const dead = db().prepare(`SELECT COUNT(*) n FROM federation_deliveries WHERE target_site=? AND status='dead'`).get(siteId).n;
  if (dead >= Math.min(Math.max(Number(quota.maxDeadLetters) || 10000, 1), 1000000)) return { allowed: false, status: 429, reason: 'SITE_DEAD_LETTER_LIMIT' };
  if (quota.minFreeBytes) {
    const configuredDbPath = config?.db?.path;
    const storagePath = configuredDbPath && configuredDbPath !== ':memory:'
      ? path.dirname(path.resolve(configuredDbPath))
      : process.cwd();
    const stats = fs.statfsSync(storagePath);
    if (Number(stats.bavail) * Number(stats.bsize) < Number(quota.minFreeBytes)) return { allowed: false, status: 507, reason: 'DISK_PRESSURE' };
  }
  return { allowed: true };
}

export function resetQuotaWindowsForTest() { windows.clear(); }
