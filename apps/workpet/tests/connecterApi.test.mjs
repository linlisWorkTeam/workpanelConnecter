import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const sdkPath = fileURLToPath(new URL('../ui/connecterApi.js', import.meta.url));

function loadUmd({ withModule = false } = {}) {
  const code = fs.readFileSync(sdkPath, 'utf8');
  const self = {};
  const sandbox = {
    self,
    console,
  };
  if (withModule) {
    sandbox.module = { exports: {} };
    sandbox.exports = sandbox.module.exports;
  }
  vm.runInNewContext(code, sandbox, { filename: path.basename(sdkPath) });
  return { self, module: sandbox.module };
}

test('UMD attaches ConnecterClient to global when module is absent', () => {
  const { self } = loadUmd({ withModule: false });
  assert.equal(typeof self.ConnecterClient?.createConnecterClient, 'function');
});

test('bundler CJS wrap still exposes ConnecterClient on global', () => {
  const { self, module } = loadUmd({ withModule: true });
  assert.equal(typeof module.exports.createConnecterClient, 'function');
  assert.equal(typeof self.ConnecterClient?.createConnecterClient, 'function');
  assert.equal(self.ConnecterClient, module.exports);
});
