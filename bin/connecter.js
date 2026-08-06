#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { main } from '../src/cli.js';

const entry = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (import.meta.url === entry || process.argv[1]?.endsWith('connecter.js')) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
