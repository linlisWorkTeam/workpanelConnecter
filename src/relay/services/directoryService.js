import { listRunnerBindings } from '../runners.js';

export function listRunnerDirectory(filters = {}) {
  return listRunnerBindings(filters).map((row) => ({
    ...row,
    runnerId: row.runner_id,
    channelId: row.channel_id,
    env: row.env,
    groupId: row.group_id,
    groupName: row.group_name,
    agentName: row.agent_name,
    role: row.runner_role,
    runtime: row.runtime,
    status: row.runner_status,
    lastSeenAt: row.runner_last_seen,
  }));
}
