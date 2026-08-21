#!/usr/bin/env node
process.env.FEDERATION_HOST_RESTART = '1';
await import('./federation-e2e.js');
