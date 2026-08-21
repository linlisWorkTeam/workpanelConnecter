import { spawn } from 'node:child_process';

const gates = [
  'test', 'test:relay-unit', 'test:group-console', 'test:mentions', 'test:identity', 'test:pet-login',
  'test:wp-slots', 'test:host-peers', 'test:runner-handler', 'test:runner-compat', 'test:migrations', 'test:runtime-root', 'test:migration-copy',
  'test:runner-lease', 'test:runner-fencing', 'test:runner-recovery', 'test:runner-ops', 'test:identifiers',
  'test:directory-contract', 'test:directory-projection', 'test:directory-api', 'test:enrollment', 'test:routes',
  'test:federation-contract', 'test:federation-host', 'test:federation-site', 'test:federation-routing', 'test:federation-result',
  'test:federation', 'test:federation-chaos',
  'test:federation-host-loss', 'test:federation-origin-restart', 'test:federation-target-restart', 'test:federation-host-restart', 'test:federation-inbox-retry',
  'test:federation-workpanel-outage',
  'test:p3-security', 'test:device-identity', 'test:tls-config', 'test:mtls-handshake', 'test:policy-matrix', 'test:policy-api', 'test:quota', 'test:compat',
  'test:trace-e2e', 'test:backup-restore', 'test:runner', 'test:relay', 'test:e2e-resume',
  'test:soak-smoke',
];

const npmCli = process.env.npm_execpath;
for (const gate of gates) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'release_gate.start', gate }));
  const code = await new Promise((resolve, reject) => {
    const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const args = npmCli ? [npmCli, 'run', gate] : ['run', gate];
    const child = spawn(command, args, { stdio: 'inherit', shell: !npmCli && process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode));
  });
  if (code !== 0) throw new Error(`release gate failed: ${gate} exit=${code}`);
}
console.log(`RELEASE_LOCAL_GATE_OK gates=${gates.length}`);
