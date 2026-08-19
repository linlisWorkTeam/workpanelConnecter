import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const sdkPath = fileURLToPath(new URL('../ui/connecterApi.js', import.meta.url));

function loadUmd({ withModule = false, extra = {} } = {}) {
  const code = fs.readFileSync(sdkPath, 'utf8');
  const self = {};
  const sandbox = {
    self,
    console,
    ...extra,
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

test('login is anonymous and does not require a pet token', async () => {
  const calls = [];
  const { self } = loadUmd({
    extra: {
      fetch: async (url, opts) => {
        calls.push({ url, opts });
        return {
          ok: true,
          json: async () => ({ token: 'pet-dev-token', petId: 'pet-dev-1' }),
        };
      },
    },
  });
  const body = await self.ConnecterClient.login('http://127.0.0.1:9080', {
    username: 'root',
    password: 'root',
    env: 'canary',
  });
  assert.equal(body.token, 'pet-dev-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:9080/v1/auth/login');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers?.Authorization, undefined);
});
