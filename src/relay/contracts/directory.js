const CAPABILITY_RE = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;

function boundedObject(value, field) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  if (JSON.stringify(value).length > 8192) throw new Error(`${field} is too large`);
  return value;
}

export function parseCapabilities(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error('capabilities must be an array with at most 64 items');
  const seen = new Set();
  return value.map((item) => {
    const raw = typeof item === 'string' ? { name: item } : item;
    if (!raw || typeof raw !== 'object') throw new Error('invalid capability');
    const name = String(raw.name || '').trim().toLowerCase();
    const version = String(raw.version || '1').trim();
    if (!CAPABILITY_RE.test(name)) throw new Error(`invalid capability name: ${name}`);
    if (!version || version.length > 32) throw new Error(`invalid capability version: ${name}`);
    const key = `${name}@${version}`;
    if (seen.has(key)) throw new Error(`duplicate capability: ${key}`);
    seen.add(key);
    return {
      name,
      version,
      labels: boundedObject(raw.labels, `capability ${name} labels`),
      limits: boundedObject(raw.limits, `capability ${name} limits`),
    };
  });
}

export function parseRunnerRegistration(body = {}, provisioned = {}) {
  if (JSON.stringify(body).length > 131072) throw new Error('runner registration payload is too large');
  const protocolVersion = Number(body.protocolVersion ?? provisioned.protocolVersion ?? 1);
  if (![1, 2].includes(protocolVersion)) throw new Error('unsupported runner protocolVersion');
  const maxConcurrency = Number(body.maxConcurrency ?? provisioned.maxConcurrency ?? 1);
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 50) {
    throw new Error('maxConcurrency must be an integer between 1 and 50');
  }
  const load = Number(body.load ?? 0);
  if (!Number.isFinite(load) || load < 0 || load > 1) throw new Error('load must be between 0 and 1');
  return {
    protocolVersion,
    capabilities: parseCapabilities(body.capabilities ?? provisioned.capabilities ?? []),
    maxConcurrency,
    labels: boundedObject(body.labels ?? provisioned.labels, 'labels'),
    load,
  };
}
