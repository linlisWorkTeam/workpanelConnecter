/** Keep ownership while an executor runs; loss aborts its signal and fences results. */
export function startTaskLease(client, task, acquiredAt = Date.now()) {
  const controller = new AbortController();
  const leaseMs = Number(task.leaseSec || 60) * 1000;
  const renewEveryMs = Math.max(100, Math.floor(leaseMs / 3));
  let expiresAt = acquiredAt + leaseMs;
  let renewing = false;
  let stopped = false;

  function lose(reason) {
    if (!controller.signal.aborted) controller.abort(reason);
  }

  function isActive() {
    if (!stopped && Date.now() >= expiresAt) lose('lease_expired_locally');
    return !stopped && !controller.signal.aborted;
  }

  async function renew() {
    if (renewing || !isActive()) return;
    renewing = true;
    // Use request start, not response arrival: network latency cannot extend ownership.
    const startedAt = Date.now();
    try {
      const response = await client.renew(task);
      if (!isActive()) return;
      if (response.status === 200) {
        expiresAt = startedAt + Number(response.body?.leaseSec || task.leaseSec || 60) * 1000;
      } else if (response.status < 500) {
        lose('stale_lease');
      }
    } catch {
      // Retry transient failures only while the last confirmed lease remains valid.
    } finally {
      renewing = false;
    }
  }

  const renewTimer = setInterval(renew, renewEveryMs);
  const watchdog = setInterval(isActive, Math.min(1000, Math.max(25, renewEveryMs / 4)));
  isActive();
  return {
    signal: controller.signal,
    isActive,
    stop() {
      stopped = true;
      clearInterval(renewTimer);
      clearInterval(watchdog);
    },
  };
}
