import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPrivateKeyStorage, requireDeviceScope } from '../src/relay/deviceIdentity.js';
import { siteSigningKey } from '../src/relay/envelopeSignature.js';
import { closeDb, openDb, writeTx } from '../src/relay/db.js';
import { issueCredentialTx } from '../src/relay/credentialStore.js';

assert.equal(assertPrivateKeyStorage({ deviceIdentity: {} }), true);
assert.throws(() => assertPrivateKeyStorage({ deviceIdentity: { privateKey: 'inline' } }), /secret store/);
assert.equal(siteSigningKey({ host: { keys: [{ keyId: 'active', secret: 'dev-secret', status: 'active' }] }, federation: { requireSeparateSigningKey: true } }).keyId, 'active');
assert.throws(() => siteSigningKey({ host: { token: 'bearer-only' }, federation: { requireSeparateSigningKey: true } }), /separate/);
assert.throws(() => siteSigningKey({ host: { keys: [{ keyId: 'inline', secret: 'bad', status: 'active' }] }, federation: { requireExternalSigningKey: true } }), /inline/);
process.env.CONNECTER_DEVICE_TEST_KEY = 'external-secret';
assert.equal(siteSigningKey({ host: { keys: [{ keyId: 'external', secretEnv: 'CONNECTER_DEVICE_TEST_KEY', status: 'active' }] }, federation: { requireExternalSigningKey: true } }).secret, 'external-secret');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-device-identity-'));
try {
  openDb(path.join(root, 'identity.db'));
  const issued = await writeTx((database) => {
    database.prepare(`INSERT INTO subjects (subject_id,site_id,kind,local_id,status) VALUES ('subject-device','site-a','agent','agent-a','active')`).run();
    return issueCredentialTx(database, { subjectId: 'subject-device', scopes: { operations: ['runner.register'], capabilities: ['code.review'] } });
  });
  assert.equal(requireDeviceScope(issued.token, 'runner.register').allowed, true);
  assert.equal(requireDeviceScope(issued.token, 'code.review').allowed, true);
  assert.equal(requireDeviceScope(issued.token, 'image.generate').reason, 'SCOPE_DENIED');
  assert.equal(requireDeviceScope('invalid', 'runner.register').reason, 'CREDENTIAL_INVALID');
} finally {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('DEVICE_IDENTITY_UNIT_OK');
