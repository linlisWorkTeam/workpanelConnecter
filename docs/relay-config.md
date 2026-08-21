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
| `host` | 本站加入 Connecter Host，或本进程作为唯一 Host；`tls` 可配置 CA 与 mTLS 客户端证书 |
| `federation` | 跨站开关、默认拒绝策略、签名/TLS 要求、TTL、重试与容量配额 |
| `enrollment` | Runner 一次性接入码、设备凭证 TTL，以及生产环境静态 token 禁用开关 |
| `retention` | 终态消息、遥测与审计工作集保留期；旧审计归档而非删除 |

生产部署应设置 `federation.requireTls=true`、`requireSignatures=true`、`requireExternalSigningKey=true`，并通过 `host.tls.caFile/certFile/keyFile` 与 `host.keys[].secretFile|secretEnv` 从仓库外加载材料。跨站策略默认拒绝；先建立精确到 Site、GroupRef、Subject、operation、direction、capability 和 dataClassification 的 allow 规则，再开放流量。

校验（可选，需本机有 `ajv` 或编辑器 JSON Schema 插件）：把 `$schema` 指到 `relay.schema.json`。中继启动**不**强制 schema，以免未装校验器时起不来。
