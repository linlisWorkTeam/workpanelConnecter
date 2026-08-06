/**
 * Resolve env → WorkPanel backend. Connecter itself has no prod/canary slots.
 */

export function resolveBackend(config, env, { client = 'pet' } = {}) {
  const defaults = config.defaults || {};
  const name = (env || defaults.env || 'canary').trim();
  const backends = config.backends || {};

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
  return Object.keys(config.backends || {}).map((name) => ({
    name,
    baseUrl: config.backends[name].baseUrl,
    kind: config.backends[name].kind || 'workpanel',
  }));
}
