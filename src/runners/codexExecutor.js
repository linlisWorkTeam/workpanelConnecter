import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { runCodexCli } from './codexCliAdapter.js';

function sessionFile(runtime) {
  return path.resolve(runtime.codex.sessionFile || path.join(ROOT, 'data', 'codex-runner-sessions.json'));
}

function loadSessions(runtime) {
  if ((runtime.codex.sessionMode || 'ephemeral') !== 'persistent') return {};
  try {
    return JSON.parse(fs.readFileSync(sessionFile(runtime), 'utf8'));
  } catch {
    return {};
  }
}

function saveSessions(runtime, sessions) {
  if ((runtime.codex.sessionMode || 'ephemeral') !== 'persistent') return;
  const file = sessionFile(runtime);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(sessions, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function taskSessionKey(task, workspace) {
  return `${task.env || ''}:${task.groupId}:${task.agentName}:${workspace}`;
}

/** Codex-specific workspace, session and output handling. */
export function createCodexExecutor(runtime) {
  const sessions = loadSessions(runtime);
  return async function executeCodex(task, { signal }) {
    const workspace = runtime.workspaceByGroup.get(String(task.groupId)) || runtime.codex.workspace;
    if (!workspace || !path.isAbsolute(workspace) || !fs.existsSync(workspace)) {
      return { status: 'failed', content: 'Codex Runner workspace is not configured or does not exist.', writeBack: false };
    }
    const key = taskSessionKey(task, workspace);
    const sessionMode = runtime.codex.sessionMode || 'ephemeral';
    const result = await runCodexCli({
      command: runtime.command,
      commandArgs: Array.isArray(runtime.codex.commandArgs) ? runtime.codex.commandArgs : [],
      workspace, prompt: task.prompt,
      sessionId: sessionMode === 'persistent' ? sessions[key] || null : null,
      sessionMode,
      sandbox: runtime.codex.sandbox || 'workspace-write',
      model: runtime.codex.model || null,
      profile: runtime.codex.profile || null,
      timeoutMs: Number(runtime.codex.timeoutMs || 15 * 60 * 1000),
      signal,
    });
    if (!signal.aborted && result.ok && sessionMode === 'persistent' && result.threadId) {
      sessions[key] = result.threadId;
      saveSessions(runtime, sessions);
    }
    return {
      status: result.ok ? 'completed' : 'failed',
      content: result.ok ? result.content : `Codex Runner failed: ${result.error}`,
      writeBack: result.ok,
    };
  };
}
