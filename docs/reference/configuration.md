# Configuration reference

[English](configuration.md) · [简体中文](configuration.zh-CN.md)

The machine-readable definition is [`config/relay.schema.json`](../../config/relay.schema.json), and the redacted example is [`config/relay.example.json`](../../config/relay.example.json). A real `config/relay.json` is ignored by Git. Never commit credentials, private keys, or signing keys.

| Field | Purpose |
|---|---|
| `listen` | HTTP listener; `CONNECTER_RELAY_HOST` and `CONNECTER_RELAY_PORT` can override it |
| `publicBaseUrl` | URL prefix used in Runner task and heartbeat responses |
| `db.path` | SQLite file path |
| `auth.tokens` | Operations API Bearer tokens |
| `allowProdFromPet` | Whether WorkPet may access `prod` |
| `rateLimitPerMin` | WorkPet request limit per minute; default 60 |
| `backends` | Mapping from environment names to WorkPanel HTTP slots |
| `defaults` | Default environment, group, and coordinator Agent |
| `pets` | WorkPet identities, tokens, WorkPanel credentials, and group bindings |
| `runners` | Preconfigured Runners and group bindings |
| `host` | Site or Host role, peer address, TLS, and signing material |
| `federation` | Cross-site policy, signing/TLS, retry, TTL, and quota settings |
| `enrollment` | One-time enrollment codes and device credential TTLs |

`host.role` may be `connecter`, `host`, or `standalone`. Production deployments should load TLS and signing material from external files or environment variables and explicitly review federation policies.

For full field behavior, see [`relay-config.md`](../relay-config.md). Runner, Directory, and Federation contracts are documented under [`protocol/`](../protocol/).
