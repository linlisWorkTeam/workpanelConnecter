import crypto from 'node:crypto';
import fs from 'node:fs';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function federationSigningBytes(envelope) {
  const unsigned = { ...envelope };
  delete unsigned.signature;
  return canonical(unsigned);
}

export function signFederationEnvelope(envelope, { keyId, secret }) {
  if (!keyId || !secret) throw new Error('federation signing key required');
  return { ...envelope, keyId, signature: crypto.createHmac('sha256', secret).update(federationSigningBytes({ ...envelope, keyId })).digest('base64url') };
}

export function verifyFederationEnvelopeSignature(envelope, keys = []) {
  if (!envelope?.keyId || !envelope?.signature) return false;
  const key = keys.find((item) => item.keyId === envelope.keyId && item.status !== 'revoked');
  if (!key?.secret) return false;
  const expected = crypto.createHmac('sha256', key.secret).update(federationSigningBytes(envelope)).digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(String(envelope.signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function siteSigningKey(config) {
  const keys = config?.host?.keys || [];
  const active = keys.find((item) => item.status === 'active') || keys[0];
  if (active) {
    if (config?.federation?.requireExternalSigningKey && active.secret) throw new Error('inline federation signing secrets are forbidden');
    return { ...active, secret: active.secret || process.env[active.secretEnv] || (active.secretFile ? fs.readFileSync(active.secretFile, 'utf8').trim() : null) };
  }
  if (config?.federation?.requireSeparateSigningKey) throw new Error('separate federation signing key required');
  return { keyId: 'peer-token-v1', secret: config?.host?.token };
}

export function peerVerificationKeys(peerConfig) {
  return peerConfig?.keys?.length
    ? peerConfig.keys.map((key) => ({ ...key, secret: key.secret || process.env[key.secretEnv] || (key.secretFile ? fs.readFileSync(key.secretFile, 'utf8').trim() : null) }))
    : [{ keyId: 'peer-token-v1', secret: peerConfig?.token, status: 'active' }];
}

export function hasOnlyExternalSigningKeys(peerConfig) {
  return Boolean(peerConfig?.keys?.length) && peerConfig.keys.every((key) => !key.secret && (key.secretEnv || key.secretFile));
}
