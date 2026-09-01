import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 8 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 128 * 1024;

function truncateUtf8(value, maxBytes) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return `${text.slice(0, end)}\n[truncated]`;
}

export function parseCodexJsonlLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return { type: 'empty' };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { type: 'invalid', error: 'invalid_jsonl' };
  }
  const type = String(value.type || 'unknown');
  if (type === 'thread.started') {
    return { type, threadId: String(value.thread_id || '').trim() || null };
  }
  if (type === 'turn.completed') return { type, turnCompleted: true };
  if (type === 'turn.failed' || type === 'error') {
    const message = value?.error?.message || value?.message || 'Codex turn failed';
    return { type, failure: truncateUtf8(message, DEFAULT_MAX_STDERR_BYTES) };
  }
  if (type === 'item.completed' && value?.item?.type === 'agent_message') {
    const text = String(value.item.text || '').trim();
    return { type, finalText: text || null };
  }
  return { type };
}

export function resolveCodexExecutable(override = process.env.CONNECTER_CODEX_COMMAND) {
  if (override && String(override).trim()) return String(override).trim();
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(locator, ['codex'], { encoding: 'utf8', windowsHide: true });
  const paths = String(found.stdout || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (process.platform === 'win32') {
    const executable = paths.find((item) => /\.exe$/i.test(item));
    if (executable) return executable;
  }
  return paths[0] || 'codex';
}

export function buildCodexArgs({
  workspace,
  sessionId = null,
  sessionMode = 'ephemeral',
  sandbox = 'workspace-write',
  model = null,
  profile = null,
  skipGitRepoCheck = true,
} = {}) {
  if (!workspace) throw new Error('Codex workspace is required');
  if (sessionId) {
    const args = ['exec', 'resume', '--json'];
    if (model) args.push('--model', String(model));
    args.push(String(sessionId), '-');
    return args;
  }
  const args = [
    'exec',
    '--json',
    '--cd',
    String(workspace),
    '--sandbox',
    String(sandbox),
  ];
  if (sessionMode === 'ephemeral') args.push('--ephemeral');
  if (skipGitRepoCheck) args.push('--skip-git-repo-check');
  if (model) args.push('--model', String(model));
  if (profile) args.push('--profile', String(profile));
  args.push('-');
  return args;
}

export async function runCodexCli({
  command = resolveCodexExecutable(),
  commandArgs = [],
  workspace,
  prompt,
  sessionId = null,
  sessionMode = 'ephemeral',
  sandbox = 'workspace-write',
  model = null,
  profile = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
  maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
  maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
  signal = null,
  spawnImpl = spawn,
} = {}) {
  const args = buildCodexArgs({
    workspace,
    sessionId,
    sessionMode,
    sandbox,
    model,
    profile,
  });
  const child = spawnImpl(command, [...commandArgs, ...args], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  });
  let stdoutBytes = 0;
  let stderr = '';
  let finalText = '';
  let threadId = sessionId;
  let turnCompleted = false;
  let failure = null;
  let abortReason = null;

  const stop = (reason) => {
    if (abortReason) return;
    abortReason = reason;
    child.kill();
  };
  const timer = setTimeout(() => stop('codex_timeout'), Math.max(1, Number(timeoutMs)));
  timer.unref?.();
  const abort = () => stop(signal?.reason ? String(signal.reason) : 'codex_aborted');
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  child.stderr.on('data', (chunk) => {
    stderr = truncateUtf8(`${stderr}${chunk.toString('utf8')}`, maxStderrBytes);
  });
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > maxStdoutBytes) stop('codex_stdout_limit');
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const event = parseCodexJsonlLine(line);
    if (event.threadId) threadId = event.threadId;
    if (event.finalText) finalText = event.finalText;
    if (event.turnCompleted) turnCompleted = true;
    if (event.failure) failure = event.failure;
  });

  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }));
  });
  child.stdin.end(String(prompt || ''));

  try {
    const status = await exit;
    const text = truncateUtf8(finalText, maxResultBytes).trim();
    if (abortReason) {
      return { ok: false, error: abortReason, threadId, stderr, ...status };
    }
    if (status.code !== 0) {
      return { ok: false, error: failure || `codex_exit_${status.code}`, threadId, stderr, ...status };
    }
    if (failure) return { ok: false, error: failure, threadId, stderr, ...status };
    if (!turnCompleted) {
      return { ok: false, error: 'codex_turn_not_completed', threadId, stderr, ...status };
    }
    if (!text) return { ok: false, error: 'codex_empty_final', threadId, stderr, ...status };
    return { ok: true, content: text, threadId, stderr: '', ...status };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
    lines.close();
  }
}
