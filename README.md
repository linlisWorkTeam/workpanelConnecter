# WorkPanelConnecter

The site connector for WorkPanel: connect WorkPet, WorkPanel, users, and Runners to a local Connecter, with cross-site delivery through Connecter Host.

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://img.shields.io/badge/CI-TODO-lightgrey)](#)
[![Release](https://img.shields.io/badge/release-v0.2.3-blue)](https://github.com/linlisWorkTeam/workpanelConnecter/releases)

## Introduction

WorkPanelConnecter is a site connection layer and cross-site relay. Each site runs one Connecter:

- WorkPet, WorkPanel, users, and Runners connect to the Connecter in their own site;
- Connecter handles local identity, durable messages, polling, Runner leases, and result delivery;
- Connecter Host registers sites, aggregates directory data, and relays cross-site messages;
- WorkPanel remains responsible for groups and message business logic, while Runners execute tasks.

### Use cases

- Run a WorkPanel site Connecter locally or on a server;
- Let WorkPet send messages to configured WorkPanel groups and poll for results;
- Connect configured Runners for registration, heartbeats, task claiming, acknowledgements, and results;
- Relay messages between multiple sites through Connecter Host.

### Unsupported scenarios and boundaries

- Connecter is not WorkPanel: it does not provide group management, a chat UI, or the business source of truth;
- Connecter is not an Agent executor, and Host does not execute Agents;
- WorkPet should not connect directly to Connecter Host or WorkPanel; standard deployments use the local site Connecter;
- `npm start` is a compatibility operations CLI, not a complete cross-site console;
- WebSocket/SSE is not the default message-return path; WorkPet uses cursor polling;
- This repository does not yet prove a production deployment with two real sites and an independent Host, production CA/mTLS key rotation, external alerting, a 72-hour soak, or Windows Authenticode signing. Do not claim production readiness from the local gates alone.

## Quick start

### Requirements

- Node.js 18 or newer;
- npm;
- Node.js 22.5 or newer is recommended for Relay, SQLite, and the full local gate suite;
- WorkPet desktop development additionally requires Rust, Tauri, and the target system's WebView build dependencies.

### Option 1: run the local smoke test

This is the smallest reproducible example. It uses the repository's mock services and does not access production.

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm install
npm test
```

A successful run includes:

```text
SMOKE_OK
GATE_OK
```

### Option 2: start a site Connecter Relay

Copy the example configuration, then fill in the WorkPanel, token, and Host values for your site. Never commit real credentials.

```bash
cp config/relay.example.json config/relay.json
CONNECTER_RELAY_CONFIG="$PWD/config/relay.json" \
CONNECTER_RELAY_PORT=9080 \
npm run relay
```

Windows PowerShell:

```powershell
Copy-Item config/relay.example.json config/relay.json
$env:CONNECTER_RELAY_CONFIG = (Resolve-Path config/relay.json).Path
$env:CONNECTER_RELAY_PORT = "9080"
npm run relay
```

In another terminal, check the health endpoint:

```bash
curl http://127.0.0.1:9080/v1/health
```

Health does not require a token; most business endpoints require a Bearer token. See the [configuration reference](docs/reference/configuration.md) and the [quickstart tutorial](docs/tutorials/quickstart.md).

### Option 3: start the compatibility operations CLI

```bash
npm start
```

The CLI reads `config/servers.json`. If it does not exist, it creates it from `config/servers.example.json`. Available commands include:

```text
/refresh
/show-server
/show-team svc-a /team-a
/chat svc-a /team-a
```

The CLI is for configured service inspection and dispatch; it does not replace Relay or cross-site Host. See the [CLI reference](docs/reference/cli.md).

### Option 4: start WorkPet desktop development

Start the site Connecter first, then prepare `~/.workpet/config.json`. Copy [`apps/workpet/config.example.json`](apps/workpet/config.example.json) and fill in the Connecter address and WorkPet token.

```bash
cd apps/workpet
npm install
npm run test:ui
npm run dev
```

WorkPet defaults to `http://127.0.0.1:9080`. In production or cross-site deployments it should still connect to its bound site Connecter, never to Host. See the [English WorkPet guide](apps/workpet/README.en.md) and the [WorkPet configuration reference](docs/workpet-config-sample.md).

### Minimal HTTP example

The following Node.js 18+ example calls only the public health endpoint. Save it as `health.mjs` and run it after starting Relay:

```js
const response = await fetch('http://127.0.0.1:9080/v1/health');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
console.log(await response.json());
```

```bash
node health.mjs
```

Chat, message, and Runner APIs require valid identity and bindings. Read the [API reference](docs/reference/api.md), and never use example tokens in production.

## FAQ

### Do I need WorkPanel running for `npm test`?

No. `npm test` uses repository mocks and is suitable for installation and basic CLI verification. Real WorkPanel integration requires the configured service.

### What is the difference between `npm run relay` and `npm start`?

`npm run relay` starts the HTTP Relay used by WorkPet, WorkPanel, and Runners. `npm start` starts the compatibility interactive operations CLI.

### Which address should WorkPet use?

Use the Connecter in the WorkPet's own site, such as `http://127.0.0.1:9080` for local development. Do not point WorkPet directly at Connecter Host or WorkPanel.

### Why do I receive 401 or 403?

401 usually means the token is missing, wrong, expired, or revoked. 403 may mean the identity lacks permission or `allowProdFromPet` blocks WorkPet from accessing production. Check identity, group, and environment bindings.

### Is this project production-ready?

The local automated gates cover core behavior, but real two-site deployment, production certificates and key rotation, external alerting, long soak testing, and code signing remain evidence boundaries. Complete and review those checks before production use.

### Where are the detailed API, configuration, and architecture documents?

Start at the [documentation home](docs/index.md), then choose Tutorials, How-to, Explanation, or Reference. This README remains an entry point with minimal runnable examples.

---

## Contributing

Most users can skip this section. Contributors should read [`CONTRIBUTING.en.md`](CONTRIBUTING.en.md).

### Local build and compilation

```bash
npm install
npm test
npm run test:docs
```

Build WorkPet:

```bash
cd apps/workpet
npm install
npm run test:ui
npm run build
```

The Windows release package is produced by `npm run build:windows` from the repository root and requires Tauri/Rust dependencies on a Windows build machine.

### Unit tests and release gates

```bash
npm test
npm run test:docs
npm run test:relay-unit
npm run test:runner
npm run test:release-local
```

The current local release suite has 51 gates; always trust the command output when the suite changes. For Relay, Runner, Federation, security, or configuration changes, run the relevant `test:*` gates and report the results in the PR.

### Pull requests

1. Create a branch from the latest `main` and keep one topic per PR;
2. Do not commit tokens, private keys, databases, build artifacts, or local configuration;
3. Report reproducible test commands and results;
4. Describe compatibility, configuration changes, risks, and rollback considerations;
5. Classify documentation changes under `docs/` and keep this README as an entry point.

## License

`package.json` currently declares `UNLICENSED`, and the repository does not yet provide a public `LICENSE` file. The maintainers need to confirm the license name, full license text, and badge URL.

<!-- TODO: Confirm the public license name, full license file, and badge URL. -->
