/**
 * In-memory view of configured servers/teams + online flags from /refresh.
 */
export class Registry {
  constructor(servers = []) {
    this.servers = servers.map((s) => ({
      ...s,
      online: false,
      lastProbeAt: null,
      lastError: null,
      teams: (s.teams || []).map((t) => ({
        ...t,
        online: false,
        lastProbeAt: null,
        lastError: null,
        agentCard: null,
      })),
    }));
  }

  listServers() {
    return this.servers;
  }

  findServer(token) {
    if (!token) return null;
    const key = String(token).toLowerCase();
    return (
      this.servers.find(
        (s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key
      ) || null
    );
  }

  findTeam(server, token) {
    if (!server || !token) return null;
    const key = String(token).toLowerCase();
    return (
      server.teams.find(
        (t) => t.id.toLowerCase() === key || t.name.toLowerCase() === key
      ) || null
    );
  }

  /** Tokens for readline completer */
  serverTokens() {
    const out = [];
    for (const s of this.servers) {
      out.push(s.id, s.name);
    }
    return [...new Set(out)];
  }

  teamTokens(server) {
    if (!server) return [];
    const out = [];
    for (const t of server.teams) {
      out.push(t.id, t.name);
    }
    return [...new Set(out)];
  }
}
