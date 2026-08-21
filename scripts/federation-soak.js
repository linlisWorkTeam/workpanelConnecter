import { spawn } from 'node:child_process';
import path from 'node:path';

const arg = process.argv.find((value) => value.startsWith('--duration-ms='));
const durationMs = arg ? Number(arg.split('=')[1]) : 72 * 60 * 60 * 1000;
if (!Number.isFinite(durationMs) || durationMs < 1000) throw new Error('duration must be at least 1000ms');
const deadline = Date.now() + durationMs;
let iterations = 0;
while (Date.now() < deadline) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('scripts/federation-e2e.js')], { cwd: path.resolve('.'), stdio: 'inherit' });
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`federation E2E failed with ${code}`)));
  });
  iterations += 1;
}
console.log(`FEDERATION_SOAK_OK durationMs=${durationMs} iterations=${iterations}`);
