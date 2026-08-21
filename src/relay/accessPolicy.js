import { db } from './db.js';

export const FEDERATION_POLICY_VERSION = 'federation-acl/v1';

function matches(value, candidate) { return value === '*' || value === candidate; }

function requestedCapabilities(value) {
  const items = Array.isArray(value) ? value : value ? [value] : ['*'];
  return [...new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function versions(items, fallback) {
  const values = [...new Set(items.map((item) => item.version).filter(Boolean))];
  return values.length ? values.join(',') : fallback;
}

export function authorizeFederation(config, {
  originSite, targetSite, groupRef, subjectId, operation = 'chat.command', direction = 'outbound',
  capabilities, dataClassification = 'internal',
}) {
  const requested = requestedCapabilities(capabilities);
  const rows = db().prepare(`SELECT * FROM federation_policies WHERE status='active' ORDER BY effect='deny' DESC, created_at DESC`).all();
  const matchesRow = (row, capability) => matches(row.origin_site, originSite) && matches(row.target_site, targetSite) &&
    matches(row.group_ref, groupRef) && (!row.subject_id || matches(row.subject_id, subjectId)) &&
    matches(row.operation, operation) && matches(row.direction, direction) &&
    matches(row.capability || '*', capability) && matches(row.data_classification || 'internal', dataClassification);
  const configuredRows = config?.federation?.policies || [];
  const matchesConfigured = (row, capability) => matches(row.originSite || '*', originSite) &&
    matches(row.targetSite || '*', targetSite) && matches(row.groupRef || '*', groupRef) &&
    matches(row.subjectId || '*', subjectId) && matches(row.operation || '*', operation) &&
    matches(row.direction || '*', direction) && matches(row.capability || '*', capability) &&
    matches(row.dataClassification || '*', dataClassification);
  const explicitDeny = rows.find((row) => row.effect === 'deny' && requested.some((capability) => matchesRow(row, capability)));
  if (explicitDeny) return { allowed: false, reason: 'POLICY_DENY', policyVersion: explicitDeny.version };
  const configuredDeny = configuredRows.find((row) => row?.effect === 'deny' && requested.some((capability) => matchesConfigured(row, capability)));
  if (configuredDeny) return { allowed: false, reason: 'CONFIG_POLICY_DENY', policyVersion: configuredDeny.version || FEDERATION_POLICY_VERSION };
  const configuredAllows = requested.map((capability) => configuredRows.find((row) => row?.effect !== 'deny' && matchesConfigured(row, capability)));
  if (configuredAllows.every(Boolean)) return { allowed: true, reason: 'CONFIG_POLICY_ALLOW', policyVersion: versions(configuredAllows, FEDERATION_POLICY_VERSION) };
  const configuredSites = config?.federation?.allowedSites;
  const configuredGroups = config?.federation?.allowedGroups;
  if (config?.federation?.legacyAllowlistEnabled === true && Array.isArray(configuredSites) && configuredSites.includes(targetSite) &&
      Array.isArray(configuredGroups) && configuredGroups.includes(groupRef)) {
    return { allowed: true, reason: 'LEGACY_CONFIG_ALLOW', policyVersion: `${FEDERATION_POLICY_VERSION}/legacy` };
  }
  const policyAllows = requested.map((capability) => rows.find((row) => row.effect === 'allow' && matchesRow(row, capability)));
  return policyAllows.every(Boolean)
    ? { allowed: true, reason: 'POLICY_ALLOW', policyVersion: versions(policyAllows, FEDERATION_POLICY_VERSION) }
    : { allowed: false, reason: 'DEFAULT_DENY', policyVersion: FEDERATION_POLICY_VERSION };
}
