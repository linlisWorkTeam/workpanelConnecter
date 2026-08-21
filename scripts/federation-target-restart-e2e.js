#!/usr/bin/env node
process.env.FEDERATION_TARGET_RESTART = '1';
await import('./federation-e2e.js');
