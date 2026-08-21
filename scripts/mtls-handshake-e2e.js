import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { federationHostRequest } from '../src/relay/federationClient.js';

function findOpenSsl() {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('OpenSSL is required for the mTLS handshake gate; set OPENSSL_BIN when it is not on PATH');
}

function run(openSsl, cwd, args) {
  const result = spawnSync(openSsl, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr || result.stdout}`);
}

function issueCertificates(root) {
  const openSsl = findOpenSsl();
  run(openSsl, root, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Connecter Test CA', '-days', '1', '-sha256']);
  fs.writeFileSync(path.join(root, 'server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run(openSsl, root, ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
  run(openSsl, root, ['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '1', '-sha256', '-extfile', 'server.ext']);
  fs.writeFileSync(path.join(root, 'client.ext'), 'extendedKeyUsage=clientAuth\n');
  run(openSsl, root, ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=site-a']);
  run(openSsl, root, ['x509', '-req', '-in', 'client.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'client.crt', '-days', '1', '-sha256', '-extfile', 'client.ext']);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connecter-mtls-'));
try {
  issueCertificates(root);
  const read = (name) => fs.readFileSync(path.join(root, name));
  let authorizedRequests = 0;
  const server = https.createServer({
    key: read('server.key'), cert: read('server.crt'), ca: read('ca.crt'), requestCert: true, rejectUnauthorized: true,
  }, (req, res) => {
    assert.equal(req.socket.authorized, true);
    assert.equal(req.headers.authorization, 'Bearer peer-token');
    authorizedRequests += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, client: req.socket.getPeerCertificate().subject.CN }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = {
    host: { baseUrl: `https://127.0.0.1:${port}`, token: 'peer-token', tls: {
      caFile: path.join(root, 'ca.crt'), certFile: path.join(root, 'client.crt'), keyFile: path.join(root, 'client.key'),
    } }, federation: { requireTls: true },
  };
  try {
    const accepted = await federationHostRequest(base, '/probe', { body: { message: 'mtls' } });
    assert.deepEqual(accepted, { ok: true, client: 'site-a' });
    assert.equal(authorizedRequests, 1);

    const withoutClient = structuredClone(base);
    delete withoutClient.host.tls.certFile;
    delete withoutClient.host.tls.keyFile;
    await assert.rejects(() => federationHostRequest(withoutClient, '/probe', { body: {} }), /certificate|alert|socket|reset|handshake/i);
    assert.equal(authorizedRequests, 1, 'unauthenticated request must not reach the application handler');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('MTLS_HANDSHAKE_E2E_OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
