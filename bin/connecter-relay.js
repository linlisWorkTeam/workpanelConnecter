#!/usr/bin/env node
import { listenRelay } from '../src/relay/server.js';

listenRelay().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
