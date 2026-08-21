# relay.json 配置说明

机器可读字段定义：[`config/relay.schema.json`](../config/relay.schema.json)。  
样例：[`config/relay.example.json`](../config/relay.example.json)（含 `"$schema": "./relay.schema.json"`）。

真实 `config/relay.json` **gitignore**，含 token/密码，不要提交。

| 段 | 干什么 |
|----|--------|
| `listen` | 中继 HTTP 监听 |
| `publicBaseUrl` | register 返回的 Runner URL 前缀 |
| `db.path` | SQLite |
| `auth.tokens` | ops bearer |
| `backends` | env → WorkPanel（`label` / `baseUrl` / 门面 `auth`） |
| `defaults` | 缺省 env / 群名 |
| `allowProdFromPet` | pet 禁 prod |
| `runners` | 出站执行槽预配，协议 [`docs/protocol/runners.md`](./protocol/runners.md) |
| `pets` | 桌宠 token 与可选 `wpAuth` |
| `host` | 本站加入 Connecter Host，或本进程当 Host |

校验（可选，需本机有 `ajv` 或编辑器 JSON Schema 插件）：把 `$schema` 指到 `relay.schema.json`。中继启动**不**强制 schema，以免未装校验器时起不来。
