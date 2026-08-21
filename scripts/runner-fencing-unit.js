#!/usr/bin/env node
// The lease gate contains the complete fencing matrix: concurrent claim,
// expired-token rejection, result idempotency and conflicting terminal data.
await import('./runner-lease-unit.js');
console.log('RUNNER_FENCING_UNIT_OK');
