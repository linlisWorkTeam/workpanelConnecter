/** HTTP transport shared by outbound Runners. Never log credentials or request bodies. */
export function createRunnerClient({ relayUrl, token, requestTimeoutMs = 10000 }) {
  const base = relayUrl.replace(/\/+$/, '');

  async function request(path, body = {}, authenticated = true) {
    const headers = { 'content-type': 'application/json' };
    if (authenticated) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${base}/v1/agents/${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, body: payload };
  }

  function taskIdentity(task) {
    return { taskId: task.taskId, leaseToken: task.leaseToken };
  }

  return {
    async register(details) {
      const response = await request('register', { ...details, token }, false);
      if (response.status !== 200) throw new Error(`runner register failed HTTP ${response.status}`);
      return response.body;
    },
    heartbeat: () => request('heartbeat'),
    // This loop executes sequentially, so it must not claim more than one lease.
    poll: () => request('tasks?limit=1'),
    ack: (task) => request('tasks/ack', taskIdentity(task)),
    renew: (task) => request('tasks/renew', taskIdentity(task)),
    result: (task, result) => request('tasks/result', { ...result, ...taskIdentity(task) }),
  };
}
