import { newTraceContext } from './identityService.js';

export function auditContext(input = {}) {
  const trace = newTraceContext(input);
  return Object.freeze({
    ...trace,
    siteId: input.siteId || null,
    subjectId: input.subjectId || null,
    operation: input.operation || null,
  });
}

export function redactAuditDetails(details = {}) {
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    out[key] = /token|password|secret|authorization/i.test(key) ? '[REDACTED]' : value;
  }
  return out;
}
