import crypto from 'node:crypto';
import { parseGroupRef } from '../services/identityService.js';

export const FEDERATION_PROTOCOL = 'workpanel.connecter.federation/v1';
export const FEDERATION_KINDS = new Set(['chat.command', 'run.event', 'run.cancel', 'delivery.receipt']);

function uuid(value, field) {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${field} must be UUID`);
  }
  return text;
}

export function validateFederationEnvelope(input, { now = Date.now(), maxPayloadBytes = 131072 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('federation envelope must be object');
  if (input.protocol !== FEDERATION_PROTOCOL) throw new Error('unsupported federation protocol');
  const messageId = uuid(input.messageId, 'messageId');
  const correlationId = uuid(input.correlationId, 'correlationId');
  const causationId = input.causationId == null ? null : uuid(input.causationId, 'causationId');
  const traceId = uuid(input.traceId, 'traceId');
  const originSite = String(input.originSite || '').trim().toLowerCase();
  const targetSite = String(input.targetSite || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(originSite) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(targetSite)) {
    throw new Error('invalid federation site');
  }
  parseGroupRef(input.groupRef);
  const kind = String(input.kind || '');
  if (!FEDERATION_KINDS.has(kind)) throw new Error('invalid federation kind');
  const createdAtMs = Date.parse(input.createdAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs) {
    throw new Error('invalid federation timestamps');
  }
  if (expiresAtMs - createdAtMs > 24 * 60 * 60 * 1000) throw new Error('federation TTL exceeds 24h');
  if (expiresAtMs <= now) throw new Error('federation envelope expired');
  const hop = Number(input.hop || 0);
  if (!Number.isInteger(hop) || hop < 0 || hop > 4) throw new Error('invalid federation hop');
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  if (Buffer.byteLength(JSON.stringify(payload)) > maxPayloadBytes) throw new Error('federation payload too large');
  return {
    protocol: FEDERATION_PROTOCOL,
    messageId,
    correlationId,
    causationId,
    originSite,
    targetSite,
    groupRef: input.groupRef,
    fromSubject: uuid(input.fromSubject, 'fromSubject'),
    toSubject: uuid(input.toSubject, 'toSubject'),
    kind,
    payload,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    hop,
    traceId,
    keyId: input.keyId || null,
    signature: input.signature || null,
  };
}

export function createFederationEnvelope({ ttlSec = 300, ...input }) {
  const createdAt = new Date();
  const envelope = {
    protocol: FEDERATION_PROTOCOL,
    messageId: input.messageId || crypto.randomUUID(),
    correlationId: input.correlationId || crypto.randomUUID(),
    causationId: input.causationId || null,
    originSite: input.originSite,
    targetSite: input.targetSite,
    groupRef: input.groupRef,
    fromSubject: input.fromSubject,
    toSubject: input.toSubject,
    kind: input.kind,
    payload: input.payload || {},
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + Math.min(Math.max(Number(ttlSec) || 300, 1), 86400) * 1000).toISOString(),
    hop: input.hop || 0,
    traceId: input.traceId || crypto.randomUUID(),
    keyId: input.keyId || null,
    signature: input.signature || null,
  };
  return validateFederationEnvelope(envelope);
}
