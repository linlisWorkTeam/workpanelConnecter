/**
 * Bearer auth against SQLite sessions (bootstrapped from config pets).
 * Legacy config.auth.tokens still accepted for ops/gate if present.
 */

import { extractBearer } from './auth.js';
import {
  findSessionByToken,
  touchPet,
  checkRateLimit,
} from './registry.js';
import { findRunnerByToken, touchRunner } from './runners.js';
import { findHostPeerByToken } from './hostPeers.js';
import { findCredentialByToken } from './credentialStore.js';

export { extractBearer, checkBearer as checkBearerLegacy } from './auth.js';

function findWorkpanelService(config, token) {
  const matches = (config?.workpanelServices || []).filter(
    (service) => String(service?.token || '') === token
  );
  if (matches.length !== 1) return { service: null, conflict: matches.length > 1 };
  const service = matches[0];
  const serviceId = String(service.id || service.serviceId || '').trim();
  if (!serviceId) return { service: null, conflict: true };
  return {
    service: {
      id: serviceId,
      scopes: Array.isArray(service.scopes) ? service.scopes.map(String) : [],
      groupRefs: Array.isArray(service.groupRefs) ? service.groupRefs.map(String) : [],
      targetSubjectIds: Array.isArray(service.targetSubjectIds)
        ? service.targetSubjectIds.map(String)
        : [],
    },
    conflict: false,
  };
}

export function authenticateRequest(
  req,
  config,
  { rateLimit = true, rateBucket = 'chat', limitPerMin } = {}
) {
  const token = extractBearer(req);
  if (!token) {
    return { ok: false, status: 401, error: 'missing bearer token' };
  }

  // WorkPanel provider credentials are a separate principal type. A provider
  // token must never double as a pet, runner, peer, device, or ops credential.
  const workpanel = findWorkpanelService(config, token);
  if (workpanel.conflict) {
    return { ok: false, status: 500, error: 'invalid workpanel service configuration' };
  }
  if (workpanel.service) {
    const collision =
      (config?.auth?.tokens || []).includes(token) ||
      Boolean(findSessionByToken(token)) ||
      Boolean(findRunnerByToken(token)) ||
      Boolean(findHostPeerByToken(token)) ||
      Boolean(findCredentialByToken(token));
    if (collision) {
      return { ok: false, status: 500, error: 'workpanel service credential conflicts with another principal' };
    }
    return {
      ok: true,
      kind: 'workpanel-service',
      service: workpanel.service,
      client: 'workpanel-service',
    };
  }

  // Prefer pet session (N1)
  const session = findSessionByToken(token);
  if (session) {
    if (session.status !== 'active') {
      return { ok: false, status: 401, error: 'session revoked' };
    }
    if (rateLimit) {
      const lim =
        limitPerMin ??
        (rateBucket === 'console'
          ? config.consoleRateLimitPerMin ?? 120
          : config.rateLimitPerMin ?? 60);
      const rl = checkRateLimit(session.pet_id, lim, rateBucket);
      if (!rl.ok) {
        return { ok: false, status: 429, error: rl.error };
      }
    }
    touchPet(session.pet_id);
    return {
      ok: true,
      kind: 'pet',
      petId: session.pet_id,
      session,
      client: 'pet',
    };
  }

  // Ops / legacy tokens in config.auth.tokens
  const tokens = config?.auth?.tokens || [];
  if (tokens.includes(token)) {
    return { ok: true, kind: 'ops', petId: null, client: 'ops' };
  }

  // runner token (E1/E2 pluggable slot)
  const runner = findRunnerByToken(token);
  if (runner) {
    if (runner.status !== 'active') {
      return { ok: false, status: 401, error: 'runner disabled' };
    }
    const credential = findCredentialByToken(token);
    if (config?.enrollment?.requireDeviceCredentials === true && !credential) {
      return { ok: false, status: 401, error: 'device credential required' };
    }
    touchRunner(runner.id);
    return { ok: true, kind: 'runner', petId: null, runner, credential, client: 'runner' };
  }

  const peer = findHostPeerByToken(token);
  if (peer) {
    if (peer.status !== 'active') {
      return { ok: false, status: 401, error: 'peer disabled' };
    }
    return {
      ok: true,
      kind: 'peer',
      petId: null,
      peer,
      client: 'peer',
    };
  }

  return { ok: false, status: 401, error: 'invalid bearer token' };
}
