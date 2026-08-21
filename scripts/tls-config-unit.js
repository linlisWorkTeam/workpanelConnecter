#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadHostTlsOptions, validateFederationClientConfig } from '../src/relay/federationClient.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-tls-config-'));
try {
  const caFile = path.join(root, 'ca.pem');
  const certFile = path.join(root, 'client.pem');
  const keyFile = path.join(root, 'client-key.pem');
  fs.writeFileSync(caFile, 'test-ca');
  fs.writeFileSync(certFile, 'test-cert');
  fs.writeFileSync(keyFile, 'test-key');
  const options = loadHostTlsOptions({ host: { tls: { caFile, certFile, keyFile, serverName: 'host.example' } } });
  assert.equal(options.ca.toString(), 'test-ca');
  assert.equal(options.cert.toString(), 'test-cert');
  assert.equal(options.key.toString(), 'test-key');
  assert.equal(options.servername, 'host.example');
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(validateFederationClientConfig({ host: { baseUrl: 'https://host.example', token: 'token', tls: { caFile, certFile, keyFile } }, federation: { requireTls: true } }), true);
  assert.equal(validateFederationClientConfig({ host: { baseUrl: 'http://127.0.0.1:9080', token: 'token' }, federation: { requireTls: true } }), true);
  assert.throws(() => validateFederationClientConfig({ host: { baseUrl: 'http://remote.example', token: 'token' }, federation: { requireTls: true } }), /HTTPS is required/);
  assert.throws(() => loadHostTlsOptions({ host: { tls: { certFile } } }), /configured together/);
  assert.throws(() => loadHostTlsOptions({ host: { tls: { caFile: path.join(root, 'missing.pem') } } }), /file not found/);
  console.log('TLS_CONFIG_UNIT_OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
