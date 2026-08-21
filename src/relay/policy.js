export const ROUTE_POLICY_VERSION = 'directory-route/v1';

export function evaluateRouteCandidate({ membership, endpoint, capabilities, requiredCapabilities = [] }) {
  if (!membership || membership.status !== 'active') return { allowed: false, reason: 'NOT_A_GROUP_MEMBER' };
  if (!endpoint || endpoint.status !== 'active') return { allowed: false, reason: 'ENDPOINT_INACTIVE' };
  if (endpoint.expires_at && endpoint.expires_at <= endpoint.now) return { allowed: false, reason: 'ENDPOINT_OFFLINE' };
  const names = new Set((capabilities || []).map((item) => item.name));
  const missing = requiredCapabilities.filter((name) => !names.has(String(name).toLowerCase()));
  if (missing.length) return { allowed: false, reason: 'CAPABILITY_MISSING', missing };
  return { allowed: true, reason: 'ALLOWED' };
}
