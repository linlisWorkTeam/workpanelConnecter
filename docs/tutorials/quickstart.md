# Quickstart

[English](quickstart.md) · [简体中文](quickstart.zh-CN.md)

This tutorial starts from a clean checkout, runs the smallest smoke test, and starts a local Site Connecter. It does not require a real WorkPanel, real tokens, or a Connecter Host.

## 1. Install Node.js

Use Node.js 18 or newer. Node.js 22.5 or newer is recommended for Relay, SQLite, and the full test suite.

```bash
node --version
npm --version
```

## 2. Clone and run the smoke test

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm install
npm test
```

Success includes:

```text
SMOKE_OK
GATE_OK
```

The smoke test uses repository mocks and does not contact a production WorkPanel.

## 3. Prepare Site Connecter configuration

Copy the example configuration. Do not edit or commit the example file:

```bash
cp config/relay.example.json config/relay.json
```

Windows PowerShell:

```powershell
Copy-Item config/relay.example.json config/relay.json
```

At minimum, inspect these fields:

- `listen.port`: use `9080` for local development;
- `backends.canary.baseUrl`: the WorkPanel canary address for this site;
- `pets[].token`, `runners[].token`, and `auth.tokens`: local test values only;
- `host`: use `role: standalone` when no Host experiment is configured;
- `allowProdFromPet`: keep the default `false` unless production access is explicitly reviewed.

See the [configuration reference](../reference/configuration.md) and the [detailed relay configuration](../relay-config.md).

## 4. Start Relay

```bash
CONNECTER_RELAY_CONFIG="$PWD/config/relay.json" \
CONNECTER_RELAY_PORT=9080 \
npm run relay
```

PowerShell:

```powershell
$env:CONNECTER_RELAY_CONFIG = (Resolve-Path config/relay.json).Path
$env:CONNECTER_RELAY_PORT = "9080"
npm run relay
```

In another terminal, check health:

```bash
curl http://127.0.0.1:9080/v1/health
```

## 5. Run focused gates

```bash
npm run test:docs
npm run test:relay-unit
npm run test:runner
```

The full local release gate is:

```bash
npm run test:release-local
```

## 6. Continue with an integration

- [How-to guides](../how-to/README.md) for task-based operations;
- [Reference](../reference/README.md) for CLI, configuration, and API details;
- [Explanation](../explanation/README.md) for site/Host boundaries and roadmap;
- [WorkPet setup](../../apps/workpet/README.md) for desktop development.

<!-- TODO: Add the real canary security-login and WorkPet desktop acceptance steps after they are confirmed. -->
