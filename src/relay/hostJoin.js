/**
 * Site Connecter joins Connecter Host (outbound only).
 */
import { hostRole } from './hostPeers.js';

const state = {
  role: 'standalone',
  linked: false,
  siteId: null,
  lastError: null,
  hostUrl: null,
};

let timer = null;
let stopped = false;

export function hostJoinState() {
  return { ...state };
}

async function jsonFetch(url, { method = 'POST', token, body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timerId);
  }
}

export async function joinHostOnce(config) {
  const h = config?.host || {};
  const base = String(h.baseUrl || '').replace(/\/+$/, '');
  const siteId = String(h.siteId || '').trim();
  const token = String(h.token || '');
  if (!base || !siteId || !token) {
    throw new Error('host.baseUrl, host.siteId, host.token required');
  }
  let reg = await jsonFetch(`${base}/v1/host/peers/register`, {
    body: {
      siteId,
      token,
      label: h.label || siteId,
      publicBaseUrl: config.publicBaseUrl || null,
    },
  });
  if (reg.status !== 200) {
    throw new Error(`host register HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  const beat = await jsonFetch(`${base}/v1/host/peers/heartbeat`, {
    token,
    body: {},
  });
  if (beat.status !== 200) {
    throw new Error(`host heartbeat HTTP ${beat.status} ${JSON.stringify(beat.body)}`);
  }
  state.linked = true;
  state.lastError = null;
  state.siteId = siteId;
  state.hostUrl = base;
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
    state.lastError = null;
    return { stop: stopHostJoin };
  }
  const intervalMs = Number(config?.host?.heartbeatMs) > 0 ? Number(config.host.heartbeatMs) : 15000;
  const tick = async () => {
    if (stopped) return;
    try {
      const was = state.linked;
      await joinHostOnce(config);
      if (!was) console.log(`[host-join] linked site=${state.siteId} host=${state.hostUrl}`);
    } catch (err) {
      state.linked = false;
      state.lastError = String(err.message || err);
      console.error(`[host-join] ${state.lastError}`);
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: stopHostJoin };
}

export function stopHostJoin() {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
