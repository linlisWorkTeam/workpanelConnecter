import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runner-config-'));
const configPath = path.join(temporary, 'relay.json');
const backups = path.join(temporary, 'backups');
const initial = {
  listen: { port: 9080 },
  db: { path: 'data/original.db' },
  auth: { tokens: ['ops-test'] },
  backends: { remote: { baseUrl: 'http://example.invalid', kind: 'workpanel', auth: { username: 'u', password: 'p' } } },
  pets: [{ id: 'pet', token: 'pet-token', groups: [] }],
};
fs.writeFileSync(configPath, JSON.stringify(initial), 'utf8');

JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'relay.schema.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function provision() {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'provision-codex-runner.js'),
    '--config', configPath,
    '--workspace', ROOT,
    '--url', 'http://127.0.0.1:8081',
    '--group-id', 'group-codex-test',
    '--backup-dir', backups,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('pet-token'));
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const first = provision();
const firstToken = first.runners[0].token;
assert.equal(first.db.path, path.join('data', 'codex-runner-canary.db'));
assert.equal(first.runners[0].codex.sandbox, 'workspace-write');
assert.equal(first.runners[0].bindings.length, 1);
assert.equal(first.pets[0].groups.length, 1);
const second = provision();
assert.equal(second.runners[0].token, firstToken, 'provisioning preserves the generated credential');
assert.equal(second.runners[0].bindings.length, 1, 'runner binding is idempotent');
assert.equal(second.pets[0].groups.length, 1, 'pet binding is idempotent');
assert.equal(fs.readdirSync(backups).length, 2, 'each mutation has a recoverable backup');

console.log('CODEX_RUNNER_CONFIG_OK');
