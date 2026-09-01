import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildCodexArgs, parseCodexJsonlLine, runCodexCli } from '../src/runners/codexCliAdapter.js';

assert.deepEqual(parseCodexJsonlLine('{"type":"thread.started","thread_id":"t1"}'), {
  type: 'thread.started', threadId: 't1',
});
assert.equal(
  parseCodexJsonlLine('{"type":"item.completed","item":{"type":"agent_message","text":"done"}}').finalText,
  'done'
);
assert.equal(parseCodexJsonlLine('{"type":"turn.completed"}').turnCompleted, true);
assert.match(parseCodexJsonlLine('{"type":"turn.failed","error":{"message":"bad"}}').failure, /bad/);
assert.equal(parseCodexJsonlLine('{"type":"future.event"}').type, 'future.event');
assert.equal(parseCodexJsonlLine('not-json').type, 'invalid');

const args = buildCodexArgs({ workspace: 'C:\\repo', sandbox: 'workspace-write' });
assert.deepEqual(args.slice(0, 4), ['exec', '--json', '--cd', 'C:\\repo']);
assert.ok(args.includes('--ephemeral'));
assert.ok(!args.includes('--ask-for-approval'));
assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
const resumed = buildCodexArgs({ workspace: 'C:\\repo', sessionId: 'thread-1', model: 'm' });
assert.deepEqual(resumed, ['exec', 'resume', '--json', '--model', 'm', 'thread-1', '-']);

function fakeSpawn(lines, { code = 0, stderr = '', delayMs = 5 } = {}) {
  return (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.stdout.end();
      child.stderr.end();
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    };
    setTimeout(() => {
      for (const line of lines) child.stdout.write(line);
      if (stderr) child.stderr.write(stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code, null);
    }, delayMs);
    return child;
  };
}

const success = await runCodexCli({
  command: 'fake', commandArgs: ['shim.js'], workspace: process.cwd(), prompt: 'x',
  spawnImpl: ((inner) => (command, commandArgs, options) => {
    assert.equal(command, 'fake');
    assert.equal(commandArgs[0], 'shim.js');
    return inner(command, commandArgs, options);
  })(fakeSpawn([
    '{"type":"thread.started","thread_id":"t1"}\r\n',
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n',
    '{"type":"future.event"}\n',
    '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}\n',
    '{"type":"turn.completed"}\n',
  ])),
});
assert.equal(success.ok, true);
assert.equal(success.content, 'final');
assert.equal(success.threadId, 't1');

const failed = await runCodexCli({
  command: 'fake', workspace: process.cwd(), prompt: 'x',
  spawnImpl: fakeSpawn([
    '{"type":"turn.failed","error":{"message":"denied"}}\n',
  ], { code: 1, stderr: 'private noisy detail' }),
});
assert.equal(failed.ok, false);
assert.match(failed.error, /denied/);
assert.ok(!failed.error.includes('private noisy detail'));

const empty = await runCodexCli({
  command: 'fake', workspace: process.cwd(), prompt: 'x',
  spawnImpl: fakeSpawn(['{"type":"turn.completed"}\n']),
});
assert.equal(empty.error, 'codex_empty_final');

console.log('CODEX_RUNNER_UNIT_OK');
