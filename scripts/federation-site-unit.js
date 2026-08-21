#!/usr/bin/env node
// Stronger-than-unit Site queue gate: real Site process, lost Host ack response,
// retained inbox body, local retry and completion reconciliation.
await import('./federation-inbox-retry-e2e.js');
console.log('FEDERATION_SITE_UNIT_OK');
