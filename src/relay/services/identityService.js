import crypto from 'node:crypto';

const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSiteId(value) {
  const siteId = String(value || '').trim().toLowerCase();
  if (!SITE_RE.test(siteId)) throw new Error('invalid siteId');
  return siteId;
}

function deterministicUuid(value) {
  const bytes = crypto.createHash('sha256').update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function stableSubjectId({ siteId, kind, localId }) {
  const site = normalizeSiteId(siteId);
  const subjectKind = String(kind || '').trim().toLowerCase();
  const id = String(localId || '').trim();
  if (!['user', 'agent', 'workpet', 'service'].includes(subjectKind)) throw new Error('invalid subject kind');
  if (!id || id.length > 256) throw new Error('invalid local subject id');
  return deterministicUuid(`workpanel-connecter/subject/${site}/${subjectKind}/${id}`);
}

export function groupRef({ authority, groupId }) {
  const owner = normalizeSiteId(authority);
  const id = String(groupId || '').trim();
  if (!id || id.length > 256) throw new Error('invalid groupId');
  return `wp:${owner}:${encodeURIComponent(id)}`;
}

export function parseGroupRef(value) {
  const match = String(value || '').match(/^wp:([a-z0-9][a-z0-9-]{0,62}):(.+)$/);
  if (!match) throw new Error('invalid groupRef');
  return { authority: normalizeSiteId(match[1]), groupId: decodeURIComponent(match[2]) };
}

export function newTraceContext({ correlationId, causationId } = {}) {
  const correlation = correlationId || crypto.randomUUID();
  const causation = causationId || null;
  if (!UUID_RE.test(correlation)) throw new Error('invalid correlationId');
  if (causation && !UUID_RE.test(causation)) throw new Error('invalid causationId');
  return { traceId: crypto.randomUUID(), correlationId: correlation, causationId: causation };
}
