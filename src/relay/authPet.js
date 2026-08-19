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

export { extractBearer, checkBearer as checkBearerLegacy } from './auth.js';

export function authenticateRequest(
  req,
  config,
  { rateLimit = true, rateBucket = 'chat', limitPerMin } = {}
) {
  const token = extractBearer(req);
  if (!token) {
    return { ok: false, status: 401, error: 'missing bearer token' };
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
    touchRunner(runner.id);
    return { ok: true, kind: 'runner', petId: null, runner, client: 'runner' };
  }

  return { ok: false, status: 401, error: 'invalid bearer token' };
}
