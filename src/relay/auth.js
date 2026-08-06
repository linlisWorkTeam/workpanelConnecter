/**
 * Bearer token check for relay API (except health).
 */

export function extractBearer(reqOrHeaders) {
  const headers = reqOrHeaders.headers || reqOrHeaders;
  const raw = headers.authorization || headers.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function checkBearer(reqOrHeaders, config) {
  const tokens = config?.auth?.tokens || [];
  if (!tokens.length) {
    return { ok: false, error: 'relay auth not configured' };
  }
  const got = extractBearer(reqOrHeaders);
  if (!got) {
    return { ok: false, error: 'missing bearer token' };
  }
  if (!tokens.includes(got)) {
    return { ok: false, error: 'invalid bearer token' };
  }
  return { ok: true, error: null };
}
