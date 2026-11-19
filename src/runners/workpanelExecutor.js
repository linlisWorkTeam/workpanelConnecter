import { setTimeout as sleep } from 'node:timers/promises';
import { dispatchWorkPanel, wpListGroupMessages, extractWpMessageText } from '../workpanelClient.js';

function backendAsServer(backend) {
  return {
    kind: 'workpanel',
    baseUrl: backend.baseUrl,
    auth: backend.auth || {},
  };
}

async function waitForAgentReply(server, groupId, runId, { waitMs, pollMs, afterTs, signal }) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const page = await wpListGroupMessages(server, groupId, { limit: 40 });
    signal.throwIfAborted();
    if (page.ok) {
      for (const m of page.messages || []) {
        if (runId && m.parentRunId === runId) {
          const text = extractWpMessageText(m.content);
          if (text && !text.includes('【Connecter 调度】')) return { ok: true, text, messageId: m.id };
        }
        if (!runId && afterTs && Number(m.createdAt) > afterTs) {
          const text = extractWpMessageText(m.content);
          if (text && !text.includes('【Connecter 调度】')) return { ok: true, text, messageId: m.id };
        }
      }
    }
    await sleep(pollMs, undefined, { signal });
  }
  return { ok: false, error: 'agent_reply_timeout' };
}

/** Lease loss stops observation; it cannot cancel an already dispatched WorkPanel run. */
export function createWorkpanelExecutor(config, { pollMs = 2000, waitMs = 45000 } = {}) {
  return async function executeWorkpanel(task, { signal, reportRunning }) {
    const env = task.env || config.defaults?.env || 'canary';
    const backend = config.backends?.[env];
    if (!backend || /:8080\b/.test(backend.baseUrl || '')) {
      return { status: 'failed', content: 'refused: missing canary backend or prod :8080', writeBack: false };
    }
    signal.throwIfAborted();
    const server = backendAsServer(backend);
    const dispatched = await dispatchWorkPanel(server, {
      id: task.groupId, name: task.groupId, coordinatorAgentName: task.agentName,
    }, task.prompt);
    signal.throwIfAborted();
    const wpMessageId = dispatched.body?.messageId || dispatched.taskId;
    const runId = dispatched.body?.runIds?.[0] || null;
    await reportRunning(dispatched.ok
      ? `wp_accepted messageId=${wpMessageId || ''} runId=${runId || ''}`
      : `wp_dispatch_failed ${dispatched.error || ''}`);
    if (!dispatched.ok) {
      return { status: 'failed', content: dispatched.error || 'wp dispatch failed', writeBack: false };
    }
    const reply = await waitForAgentReply(server, task.groupId, runId, {
      waitMs, pollMs, afterTs: Date.now() - 5000, signal,
    });
    return {
      status: reply.ok ? 'completed' : 'failed',
      content: reply.ok ? reply.text : `timeout waiting WP agent reply (wpMessageId=${wpMessageId})`,
      writeBack: false,
    };
  };
}
