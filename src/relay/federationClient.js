import fs from 'node:fs';
import https from 'node:https';

function hostConfig(config) {
  const baseUrl = String(config?.host?.baseUrl || '').replace(/\/+$/, '');
  const token = String(config?.host?.token || '');
  if (!baseUrl || !token) throw new Error('Connecter Host is not configured');
  if (config?.federation?.requireTls && !baseUrl.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseUrl)) {
    throw new Error('HTTPS is required for Connecter Host');
  }
  return { baseUrl, token };
}

export function loadHostTlsOptions(config) {
  const tls = config?.host?.tls || {};
  const read = (file, field) => {
    if (!file) return undefined;
    const resolved = String(file);
    if (!fs.existsSync(resolved)) throw new Error(`Host TLS ${field} file not found`);
    return fs.readFileSync(resolved);
  };
  const ca = read(tls.caFile, 'CA');
  const cert = read(tls.certFile, 'certificate');
  const key = read(tls.keyFile, 'private key');
  if ((cert && !key) || (!cert && key)) throw new Error('Host TLS client certificate and private key must be configured together');
  return { ca, cert, key, servername: tls.serverName || undefined, rejectUnauthorized: true };
}

export function validateFederationClientConfig(config) {
  const { baseUrl } = hostConfig(config);
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Connecter Host URL must use HTTP or HTTPS');
  if (url.protocol === 'https:') loadHostTlsOptions(config);
  return true;
}

function requestHttps(url, { method, token, body, timeoutMs, tlsOptions }) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method, ...tlsOptions,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) req.destroy(new Error('Host response exceeds 2 MiB'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        let result = {};
        try { result = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
        catch { return reject(new Error('Host response is not valid JSON')); }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          return reject(new Error(`Host ${url.pathname} HTTP ${response.statusCode}: ${JSON.stringify(result)}`));
        }
        resolve(result);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Host ${url.pathname} timeout`)));
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function federationHostRequest(config, pathname, { method = 'POST', body, timeoutMs = 8000 } = {}) {
  const { baseUrl, token } = hostConfig(config);
  const url = new URL(`${baseUrl}${pathname}`);
  if (url.protocol === 'https:') {
    return requestHttps(url, { method, token, body, timeoutMs, tlsOptions: loadHostTlsOptions(config) });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Host ${pathname} HTTP ${response.status}: ${JSON.stringify(result)}`);
    return result;
  } finally { clearTimeout(timer); }
}
