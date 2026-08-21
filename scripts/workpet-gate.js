#!/usr/bin/env node
/**
 * WorkPet SDK 门禁：对线上中继（默认 http://127.0.0.1:80）跑客户端契约验证。
 * 覆盖：health / envs / instances / chat(accepted+runId) / messages 轮询回显 / runs 查询。
 * 触发真实 canary run（预期行为）。
 *
 * 用法：npm run test:workpet   （环境变量：WORKPET_BASE_URL、WORKPET_TOKEN 可覆盖）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sdkSandbox = { self: {}, fetch, URL, AbortController, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/workpet/ui/connecterApi.js'), 'utf8'), sdkSandbox, { filename: 'connecterApi.js' });
const { createConnecterClient } = sdkSandbox.self.ConnecterClient;

const BASE = process.env.WORKPET_BASE_URL || 'http://127.0.0.1:80';

function loadToken() {
  if (process.env.WORKPET_TOKEN) return process.env.WORKPET_TOKEN;
  const cfgPath = path.join(root, 'config/relay.json');
  if (!fs.existsSync(cfgPath)) {
    console.error('WORKPET_TOKEN 未设置且 config/relay.json 不存在（gitignored，需在服务器上跑）');
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const pet = (cfg.pets || [])[0];
  if (!pet?.token) {
    console.error('config/relay.json 无 pets[0].token');
    process.exit(2);
  }
  return pet.token;
}

const token = loadToken();
const relayCfg = JSON.parse(fs.readFileSync(path.join(root, 'config/relay.json'), 'utf8'));
const d = relayCfg.defaults || {};
const pet = (relayCfg.pets || [])[0] || {};
const group = pet.groups?.[0]?.groupName || d.group;
const agent = pet.groups?.[0]?.agentName || d.coordinatorAgentName;

const client = createConnecterClient({
  connecterBaseUrl: BASE,
  token,
  env: 'canary',
  group,
  agent,
});

const checks = [];
function check(name, ok, extra = '') {
  checks.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

const msgId = 'msg_workpet_gate_' + Date.now();

try {
  const h = await client.health();
  check('health', h.ok === true, JSON.stringify(h));

  const envs = await client.envs();
  check('envs', Array.isArray(envs.envs) && envs.envs.some((e) => e.name === 'canary'), JSON.stringify(envs.envs.map((e) => e.name)));

  const inst = await client.instances();
  check('instances(pet)', Array.isArray(inst.instances) && inst.instances.length > 0, `${inst.instances.length} 实例`);

  const chat = await client.chat('workpet-gate ping（SDK 契约验证）', { id: msgId });
  const chatOk = chat.status === 'accepted' && chat.messageId === msgId && Array.isArray(chat.runIds) && chat.runIds.length > 0;
  check('chat→accepted+runId', chatOk, `messageId=${chat.messageId} runIds=${(chat.runIds || []).join(',')}`);

  const msgs = await client.messages(0);
  const echoed = (msgs.messages || []).some((m) => m.id === msgId);
  check('messages 回显', echoed, `nextCursor=${msgs.nextCursor}`);

  const runId = chat.runIds[0];
  const run = await client.runs(runId);
  check('runs 查询', !!run && !!run.id, `status=${run.status || run.ack || 'n/a'}`);

  const ok = checks.every((c) => c.ok);
  console.log(ok ? '\nWORKPET_GATE_OK' : '\nWORKPET_GATE_FAIL');
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('\nWORKPET_GATE_FAIL —', e.message);
  if (e.body) console.error(JSON.stringify(e.body));
  process.exit(1);
}
