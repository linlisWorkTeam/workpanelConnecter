# Connecter operations CLI

[English](cli.md) · [简体中文](cli.zh-CN.md)

> Status: current CLI reference; updated 2026-08-22.

`npm start` launches the compatibility interactive CLI. It reads `config/servers.json`, or creates it from `config/servers.example.json` when missing.

| Command | Status | Behavior |
|---|---|---|
| `/chat {server} /{team}` | Implemented | Send a prompt to the configured coordinator for a target team |
| `/show-server` | Implemented | Show reachability from the latest refresh |
| `/show-team {server} [/{team}]` | Implemented | List teams or show one team |
| `/refresh` | Implemented | Probe services and coordinators again |
| `/show-log [N]` | Implemented | Show the latest N dispatch records; default is 10 |
| `/restart-server` | Stub | Returns `not implemented`; does not restart a server |
| `/obs {server} [{team}]` | Stub | Returns `not implemented`; HTTP observability is documented in [`observability.md`](../observability.md) |

The CLI is not the authority for cross-site identity or membership. Those responsibilities belong to Site Connecter, Directory, and Connecter Host.

```powershell
npm start
npm test
```
