/**
 * Talk only to Team Coordinator façades.
 * - kind=workpanel → real WorkPanel APIs (canary/prod slot URL)
 * - default → HTTP mock coordinator (/health /agent-card /tasks)
 * Coordinator down ⇒ dispatch fails (no worker bypass).
 */

import {
  isWorkPanelServer,
  probeWorkPanel,
  dispatchWorkPanel,
} from './workpanelClient.js';

export function coordinatorUrl(server, team) {
  const base = server.baseUrl.replace(/\/$/, '');
  const p = (team.coordinatorPath || '/coordinator').replace(/^\//, '');
  return `${base}/${p}`;
}

export async function probeCoordinator(server, team, { timeoutMs = 2000 } = {}) {
  if (isWorkPanelServer(server)) {
    return probeWorkPanel(server, team, { timeoutMs: Math.max(timeoutMs, 5000) });
  }

  const url = `${coordinatorUrl(server, team)}/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, card: null };
    }
    let card = null;
    try {
      const cardRes = await fetch(`${coordinatorUrl(server, team)}/agent-card`, {
        signal: ctrl.signal,
      });
      if (cardRes.ok) card = await cardRes.json();
    } catch {
      /* card optional for online probe */
    }
    return { ok: true, error: null, card };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : String(err.message || err), card: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchToCoordinator(server, team, prompt, { timeoutMs = 15000 } = {}) {
  if (isWorkPanelServer(server)) {
    return dispatchWorkPanel(server, team, prompt, { timeoutMs: Math.max(timeoutMs, 20000) });
  }

  const url = `${coordinatorUrl(server, team)}/tasks`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        team_metadata_hint: { teamId: team.id, teamName: team.name },
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: 'failed',
        error: `coordinator HTTP ${res.status}`,
        body,
        taskId: body?.taskId || null,
      };
    }
    return {
      ok: true,
      status: body?.status || 'succeeded',
      error: null,
      body,
      taskId: body?.taskId || null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      error:
        err.name === 'AbortError'
          ? 'coordinator timeout/unreachable'
          : `coordinator unavailable: ${err.message || err}`,
      body: null,
      taskId: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshRegistry(registry) {
  const now = new Date().toISOString();
  for (const server of registry.listServers()) {
    let anyOnline = false;
    let lastErr = null;
    for (const team of server.teams) {
      const result = await probeCoordinator(server, team);
      team.online = result.ok;
      team.lastProbeAt = now;
      team.lastError = result.error;
      team.agentCard = result.card;
      if (result.ok) anyOnline = true;
      else lastErr = result.error;
    }
    server.online = anyOnline;
    server.lastProbeAt = now;
    server.lastError = anyOnline ? null : lastErr;
  }
}
