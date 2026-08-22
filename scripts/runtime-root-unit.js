import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeRoot, relayResourceDir } from '../src/runtimeRoot.js';

const fixture = path.join(process.cwd(), 'src', 'relay', 'server.js');
const fixtureUrl = pathToFileURL(fixture).href;

assert.equal(runtimeRoot(fixtureUrl, 2), process.cwd());
assert.equal(relayResourceDir(fixtureUrl), path.join(process.cwd(), 'src', 'relay'));

console.log('RUNTIME_ROOT_UNIT_OK');
