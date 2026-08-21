#!/usr/bin/env node
import assert from 'node:assert/strict';
import { asAgentTasksResult } from '../src/relay/runners.js';

assert.deepEqual(asAgentTasksResult({ status: 200, body: { tasks: [{ taskId: 'a' }] } }), {
  status: 200,
  body: { tasks: [{ taskId: 'a' }] },
});

assert.deepEqual(asAgentTasksResult([{ taskId: 'raw' }]), {
  status: 200,
  body: { tasks: [{ taskId: 'raw' }] },
});

assert.deepEqual(asAgentTasksResult({ tasks: [{ taskId: 'nested' }] }), {
  status: 200,
  body: { tasks: [{ taskId: 'nested' }] },
});

assert.deepEqual(asAgentTasksResult(null), { status: 200, body: { tasks: [] } });
assert.deepEqual(asAgentTasksResult(undefined), { status: 200, body: { tasks: [] } });

console.log('RUNNER_HANDLER_UNIT_OK');
