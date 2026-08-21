/**
 * Site Connecter joins Connecter Host (outbound only).
 */
import { hostRole } from './hostPeers.js';
import { federationHostRequest } from './federationClient.js';
import { flushFederationOutboxOnce, pullFederationInboxOnce, syncFederationDirectoryOnce } from './services/federationService.js';
import { logEvent } from './structuredLogger.js';

const state = {
  role: 'standalone',
  linked: false,
  controlLinked: false,
  siteId: null,
  lastError: null,
  hostUrl: null,
  federation: { linked: false, advertised: 0, imported: 0, sent: 0, pulled: 0, lastError: null },
};

let timer = null;
let stopped = false;
let ticking = false;

export function hostJoinState() {
  return { ...state };
}

export async function joinHostOnce(config) {
  const h = config?.host || {};
  const base = String(h.baseUrl || '').replace(/\/+$/, '');
  const siteId = String(h.siteId || '').trim();
  const token = String(h.token || '');
  if (!base || !siteId || !token) {
    throw new Error('host.baseUrl, host.siteId, host.token required');
  }
  await federationHostRequest(config, '/v1/host/peers/register', {
    body: {
      siteId,
      token,
      label: h.label || siteId,
      publicBaseUrl: config.publicBaseUrl || null,
    },
  });
  await federationHostRequest(config, '/v1/host/peers/heartbeat', {
    body: {},
  });
  state.controlLinked = true;
  state.linked = true;
  state.lastError = null;
  state.siteId = siteId;
  state.hostUrl = base;
  try {
    if (config?.federation?.enabled === false) {
      state.federation = { linked: false, advertised: 0, imported: 0, sent: 0, pulled: 0, lastError: null, enabled: false };
      return { ok: true, siteId };
    }
    const directory = await syncFederationDirectoryOnce(config);
    const outbound = await flushFederationOutboxOnce(config);
    const inbound = await pullFederationInboxOnce(config, { limit: 50, waitMs: 0 });
    const afterInbound = await flushFederationOutboxOnce(config);
    state.federation = {
      linked: true,
      advertised: directory.advertised, imported: directory.imported,
      sent: outbound.sent + afterInbound.sent, pulled: inbound.pulled, lastError: null,
    };
  } catch (error) {
    state.federation = { ...state.federation, linked: false, lastError: String(error.message || error) };
  }
  return { ok: true, siteId };
}

export function startHostJoin(config) {
  stopHostJoin();
  stopped = false;
  const role = hostRole(config);
  state.role = role;
  state.siteId = config?.host?.siteId || null;
  state.hostUrl = config?.host?.baseUrl ? String(config.host.baseUrl).replace(/\/+$/, '') : null;
  if (role !== 'connecter') {
    state.linked = role === 'host';
    state.controlLinked = role === 'host';
    state.federation = { ...state.federation, linked: role === 'host', lastError: null };
    state.lastError = null;
    return { stop: stopHostJoin };
  }
  const intervalMs = Number(config?.host?.heartbeatMs) > 0 ? Number(config.host.heartbeatMs) : 15000;
  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const was = state.linked;
      await joinHostOnce(config);
      if (!was) logEvent('info', 'host.control_linked', { siteId: state.siteId, hostUrl: state.hostUrl });
    } catch (err) {
      state.linked = false;
      state.controlLinked = false;
      state.federation = { ...state.federation, linked: false };
      state.lastError = String(err.message || err);
      logEvent('error', 'host.control_link_failed', { siteId: state.siteId, hostUrl: state.hostUrl, error: state.lastError });
    } finally {
      ticking = false;
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: stopHostJoin };
}

export function stopHostJoin() {
  stopped = true;
  ticking = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
