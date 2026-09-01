import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', '.linlis', '.superpowers', 'node_modules', 'target', 'dist', 'data']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirs.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function category(file) {
  const rel = relative(file);
  if (rel === 'AGENTS.md') return 'internal-instructions';
  if (/^apps\/workpet\/third-party\/.*(?:LICENSE|NOTICE)\.md$/.test(rel)) return 'third-party-immutable';
  if (/^docs\/releases\//.test(rel)) return 'release-snapshot';
  if (/^docs\/(?:canary-|epitaph\/2026-|superpowers\/)/.test(rel)) return 'historical-snapshot';
  if (/^docs\/(?:HANDOFF-|WP-E2-COLLAB|mvp-status-and-acceptance|workconnector-system-design|workpet-connecter-design|bridge-deepseek-harness)/.test(rel)) return 'historical-snapshot';
  if (/design\.md$/.test(rel)) return 'implemented-design-record';
  return 'current';
}

const markdownFiles = walk(ROOT).sort();
const errors = [];
const categories = new Map();
for (const file of markdownFiles) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  const kind = category(file);
  categories.set(kind, (categories.get(kind) || 0) + 1);

  if (kind === 'third-party-immutable') continue;

  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|#|data:)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target || path.isAbsolute(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) errors.push(`${rel}: broken link -> ${match[1]}`);
  }
}

const rootScripts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {});
const workpetScripts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/workpet/package.json'), 'utf8')).scripts || {});
const knownScripts = new Set([...rootScripts, ...workpetScripts]);
for (const file of markdownFiles) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    if (!knownScripts.has(match[1])) errors.push(`${rel}: unknown npm script -> ${match[1]}`);
  }
}

const currentFiles = markdownFiles.filter((file) => category(file) === 'current' && relative(file) !== 'docs/DOCUMENTATION-AUDIT.md');
const stalePatterns = [
  [/E3[^\n]{0,30}(?:未实现|未开始)/i, 'E3 is implemented in the local federation baseline'],
  [/跨站[^\n]{0,30}(?:尚未实现|未实现|未做)/i, 'cross-site federation is implemented locally'],
  [/桌面编包[^\n]{0,20}(?:留待|留用户|用户本机)/i, 'Windows releases publish an installer'],
  [/当前[^\n]{0,30}(?:49|50) 项/, 'the current release suite has 51 gates'],
];
for (const file of currentFiles) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, reason] of stalePatterns) {
    if (pattern.test(text)) errors.push(`${rel}: stale statement (${reason})`);
  }
}

const routeDocs = [
  'docs/api-relay.md',
  'docs/protocol/runners.md',
  'docs/protocol/directory-v2.md',
  'docs/protocol/federation-v1.md',
].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
const requiredRoutes = [
  '/v1/health', '/v1/auth/login', '/v1/envs', '/v1/backends/register', '/v1/backends/heartbeat',
  '/v1/instances', '/v1/groups', '/v1/chat', '/v1/members', '/v1/messages', '/v1/runs/', '/v1/logs',
  '/v1/session/revoke', '/v1/agents/register', '/v1/agents/heartbeat', '/v1/agents/tasks',
  '/v1/agents/tasks/ack', '/v1/agents/tasks/renew', '/v1/agents/tasks/result', '/v1/agents',
  '/v1/host/peers/register', '/v1/host/peers/heartbeat', '/v1/host/peers',
  '/v1/federation/messages', '/v1/federation/pull', '/v1/federation/ack', '/v1/federation/result',
  '/v1/federation/directory/advertise', '/v1/federation/directory', '/v1/ops/tasks',
  '/v1/ops/health/detail', '/v1/ops/traces/', '/v1/ops/federation/policies',
  '/v1/ops/federation/outbox', '/v1/ops/host/peers/', '/v1/ops/security/deliveries',
  '/v2/enrollments', '/v2/directory/subjects', '/v2/directory/endpoints', '/v2/routes/explain',
  '/v2/ops/enrollments/', '/v2/credentials/rotate', '/v2/ops/credentials/',
];
for (const route of requiredRoutes) {
  if (!routeDocs.includes(route)) errors.push(`protocol docs: missing implemented route -> ${route}`);
}

for (const required of ['docs/README.md', 'docs/DOCUMENTATION-AUDIT.md']) {
  if (!fs.existsSync(path.join(ROOT, required))) errors.push(`missing documentation governance file -> ${required}`);
}

const auditText = fs.readFileSync(path.join(ROOT, 'docs/DOCUMENTATION-AUDIT.md'), 'utf8');
for (const file of markdownFiles) {
  const rel = relative(file);
  if (rel === 'docs/DOCUMENTATION-AUDIT.md') continue;
  if (!auditText.includes(`\`${rel}\``)) errors.push(`docs/DOCUMENTATION-AUDIT.md: missing file review row -> ${rel}`);
}

for (const required of ['README.md', 'docs/architecture.md', 'docs/P0-P3-IMPLEMENTATION-STATUS.md', 'docs/ROADMAP.md', 'docs/NEXT-DEV-PATH.md']) {
  const text = fs.readFileSync(path.join(ROOT, required), 'utf8');
  if (!text.includes('51')) errors.push(`${required}: current release gate count must be 51`);
}

const versions = [
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/workpet/package.json'), 'utf8')).version,
  JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/workpet/src-tauri/tauri.conf.json'), 'utf8')).version,
  fs.readFileSync(path.join(ROOT, 'apps/workpet/src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1],
];
if (new Set(versions).size !== 1) errors.push(`release version mismatch -> ${versions.join(', ')}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`DOCUMENTATION_CONSISTENCY_OK files=${markdownFiles.length} categories=${JSON.stringify(Object.fromEntries(categories))}`);
