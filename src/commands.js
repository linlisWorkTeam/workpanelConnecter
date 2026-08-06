import {
  refreshRegistry,
  dispatchToCoordinator,
  probeCoordinator,
} from './coordinator.js';

function pad(s, n) {
  const t = String(s ?? '');
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

export function helpText() {
  return [
    'Commands:',
    '  /chat {server} /{team}     then enter prompt — dispatch via coordinator',
    '  /show-server               list online services',
    '  /show-team {server} [/{team}]',
    '  /refresh                   probe coordinator health',
    '  /show-log [n]              recent dispatches (default 10)',
    '  /restart-server            (stub) not implemented',
    '  /obs {server} [/{team}]    (stub) not implemented',
    '  /help                      this help',
    '  /quit | /exit              leave',
  ].join('\n');
}

export async function cmdRefresh(ctx) {
  await refreshRegistry(ctx.registry);
  const servers = ctx.registry.listServers();
  const online = servers.filter((s) => s.online).length;
  return `Refreshed ${servers.length} server(s); ${online} online.`;
}

export function cmdShowServer(ctx) {
  const rows = ctx.registry.listServers();
  if (!rows.length) return 'No servers in config.';
  const lines = [
    `${pad('ID', 12)} ${pad('NAME', 16)} ${pad('ONLINE', 8)} ${pad('BASE', 32)} ERROR`,
  ];
  for (const s of rows) {
    lines.push(
      `${pad(s.id, 12)} ${pad(s.name, 16)} ${pad(s.online ? 'yes' : 'no', 8)} ${pad(s.baseUrl, 32)} ${s.lastError || ''}`
    );
  }
  return lines.join('\n');
}

export function cmdShowTeam(ctx, serverToken, teamToken) {
  const server = ctx.registry.findServer(serverToken);
  if (!server) return `Unknown server: ${serverToken}`;

  if (!teamToken) {
    const lines = [
      `Server ${server.id} (${server.name}) — teams:`,
      `${pad('ID', 12)} ${pad('NAME', 16)} ${pad('COORD_ONLINE', 12)} ERROR`,
    ];
    for (const t of server.teams) {
      lines.push(
        `${pad(t.id, 12)} ${pad(t.name, 16)} ${pad(t.online ? 'yes' : 'no', 12)} ${t.lastError || ''}`
      );
    }
    return lines.join('\n');
  }

  const team = ctx.registry.findTeam(server, teamToken);
  if (!team) return `Unknown team on ${server.id}: ${teamToken}`;
  const card = team.agentCard ? JSON.stringify(team.agentCard, null, 2) : '(no agent-card yet; run /refresh)';
  return [
    `Server: ${server.id} (${server.name}) online=${server.online}`,
    `Team:   ${team.id} (${team.name}) coordinator_online=${team.online}`,
    `Path:   ${team.coordinatorPath || '/coordinator'}`,
    `Error:  ${team.lastError || '-'}`,
    'Agent Card / team_metadata:',
    card,
  ].join('\n');
}

export async function cmdChat(ctx, serverToken, teamToken, prompt) {
  const server = ctx.registry.findServer(serverToken);
  if (!server) {
    return { message: `Unknown server: ${serverToken}`, record: null };
  }
  const team = ctx.registry.findTeam(server, teamToken);
  if (!team) {
    return { message: `Unknown team: ${teamToken}`, record: null };
  }

  // Prefer fresh probe for this target; fail closed if coordinator down
  const probe = await probeCoordinator(server, team);
  team.online = probe.ok;
  team.lastError = probe.error;
  team.agentCard = probe.card || team.agentCard;
  server.online = server.teams.some((t) => t.online);

  if (!probe.ok) {
    const record = {
      serverId: server.id,
      teamId: team.id,
      status: 'failed',
      error: `coordinator unavailable: ${probe.error}`,
      promptPreview: String(prompt).slice(0, 120),
      taskId: null,
    };
    ctx.logs.append(record);
    return {
      message: `Dispatch FAILED — coordinator unavailable (${probe.error}). No bypass to worker agents.`,
      record,
    };
  }

  const result = await dispatchToCoordinator(server, team, prompt);
  const record = {
    serverId: server.id,
    teamId: team.id,
    status: result.status,
    error: result.error,
    promptPreview: String(prompt).slice(0, 120),
    taskId: result.taskId,
  };
  ctx.logs.append(record);

  if (!result.ok) {
    return {
      message: `Dispatch FAILED — ${result.error}${result.taskId ? ` taskId=${result.taskId}` : ''}`,
      record,
    };
  }
  return {
    message: `Dispatch OK — status=${result.status}${result.taskId ? ` taskId=${result.taskId}` : ''}\n${JSON.stringify(result.body, null, 2)}`,
    record,
  };
}

export function cmdShowLog(ctx, n) {
  const limit = Number.isFinite(n) && n > 0 ? n : 10;
  const rows = ctx.logs.recent(limit);
  if (!rows.length) return 'No dispatch records yet.';
  return rows
    .map((r, i) => {
      return [
        `#${i + 1} ${r.at || '?'} [${r.status}] ${r.serverId}/${r.teamId}`,
        `  taskId=${r.taskId || '-'} error=${r.error || '-'}`,
        `  prompt: ${r.promptPreview || ''}`,
      ].join('\n');
    })
    .join('\n');
}

export function cmdStub(name) {
  return `${name}: not implemented (reserved).`;
}

/** Parse: /show-team svc-a /team-a  OR /show-team svc-a */
export function parseServerTeamArgs(argsLine) {
  const raw = (argsLine || '').trim();
  if (!raw) return { server: null, team: null };
  const slash = raw.indexOf('/');
  if (slash === -1) {
    return { server: raw.split(/\s+/)[0], team: null };
  }
  // allow "svc /team" or "svc/team"
  const left = raw.slice(0, slash).trim();
  const right = raw.slice(slash + 1).trim();
  const server = left.split(/\s+/).filter(Boolean).pop() || left;
  const team = right.split(/\s+/)[0] || null;
  return { server, team };
}
