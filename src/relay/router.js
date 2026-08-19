/**
 * Resolve env → WorkPanel backend. Connecter itself has no prod/canary slots.
 */

import { backendsFor } from './wpSlots.js';

export function resolveBackend(config, env, { client = 'pet' } = {}) {
  const defaults = config.defaults || {};
  const name = (env || defaults.env || 'canary').trim();
  const backends = backendsFor(config);

  if (!backends[name]) {
    const err = new Error(`unknown env: ${name}`);
    err.code = 'UNKNOWN_ENV';
    throw err;
  }

  if (name === 'prod' && config.allowProdFromPet === false && client === 'pet') {
    const err = new Error('prod env forbidden for pet client (allowProdFromPet=false)');
    err.code = 'PROD_FORBIDDEN';
    throw err;
  }

  return {
    env: name,
    backend: backends[name],
    defaults,
  };
}

export function listEnvs(config) {
  const backends = backendsFor(config);
  return Object.keys(backends).map((name) => ({
    name,
    label: backends[name].label || null,
    baseUrl: backends[name].baseUrl,
    kind: backends[name].kind || 'workpanel',
    source: backends[name].source || 'config',
  }));
}
