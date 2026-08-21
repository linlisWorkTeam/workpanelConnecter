import { listDirectoryEndpoints, listDirectorySubjects } from '../directory.js';
import { getRouteDecision, resolveRoute } from '../routeResolver.js';

function requireOps(auth) {
  return auth?.kind === 'ops' ? null : { status: 403, body: { error: 'ops token required' } };
}

export function directorySubjectsHandler(auth, query) {
  return requireOps(auth) || { status: 200, body: { subjects: listDirectorySubjects(query) } };
}

export function directoryEndpointsHandler(auth, query) {
  return requireOps(auth) || { status: 200, body: { endpoints: listDirectoryEndpoints(query) } };
}

export function routeExplainHandler(auth, query) {
  const denied = requireOps(auth);
  if (denied) return denied;
  if (query.traceId) {
    const existing = getRouteDecision(query.traceId);
    return existing
      ? { status: 200, body: { decision: existing } }
      : { status: 404, body: { error: 'route decision not found' } };
  }
  try {
    const decision = resolveRoute({
      groupRef: query.groupRef, targetSubjectId: query.targetSubjectId, agentName: query.agentName,
      requiredCapabilities: query.requiredCapabilities || [], sourceSiteId: query.sourceSiteId,
    });
    return { status: 200, body: { decision } };
  } catch (error) {
    return { status: 400, body: { error: String(error.message || error) } };
  }
}
