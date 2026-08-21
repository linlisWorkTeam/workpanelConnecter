import { redactAuditDetails } from './services/auditService.js';

export function logEvent(level, event, fields = {}) {
  const record = { ts: new Date().toISOString(), level, event, ...redactAuditDetails(fields) };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  return record;
}
