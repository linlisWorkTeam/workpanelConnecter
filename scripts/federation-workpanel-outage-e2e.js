#!/usr/bin/env node
process.env.FEDERATION_WORKPANEL_OUTAGE = '1';
await import('./federation-e2e.js');
