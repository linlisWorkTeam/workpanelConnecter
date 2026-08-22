# `relay.json` 配置说明

机器可读定义见 [`config/relay.schema.json`](../config/relay.schema.json)，脱敏样例见 [`config/relay.example.json`](../config/relay.example.json)。真实 `config/relay.json` 已被 Git 忽略，凭证、证书私钥和签名密钥不得提交。

## 顶层字段

| 字段 | 当前用途 |
|---|---|
| `listen` | HTTP 监听地址；可由 `CONNECTER_RELAY_HOST`、`CONNECTER_RELAY_PORT` 覆盖 |
| `publicBaseUrl` | Runner 注册响应中的 task/heartbeat URL 前缀 |
| `db.path` | SQLite 文件路径 |
| `auth.tokens` | 运维 API bearer token |
| `allowProdFromPet` | 是否允许 WorkPet 访问 `prod` |
| `rateLimitPerMin` | WorkPet 普通接口每分钟限额，默认 60 |
| `consoleRateLimitPerMin` | 群控制台接口每分钟限额，默认 120 |
| `runnerHeartbeatTtlSec` | Runner 在线 TTL，默认 60 秒 |
| `runnerTaskLeaseSec` | Runner task lease，默认 60 秒 |
| `runnerTaskMaxAttempts` | lease 超时后的最大领取次数，默认 3 |
| `runnerProtocolCompatibility` | 仅迁移期设为 `v1`，允许旧 Runner 缺少 fencing 字段 |
| `directoryV2Shadow` | 只记录 Directory v2 路由决定，不改变实际投递 |
| `directoryV2RoutingEnabled` | 启用 Directory v2 实际路由 |
| `wpSlotHeartbeatTtlSec` | WorkPanel 动态槽位在线 TTL |
| `cors` | 允许的浏览器 Origin |
| `backends` | `env` 到 WorkPanel HTTP 槽位的映射 |
| `defaults` | 缺省 env、群和协调 Agent 名 |
| `pets` | WorkPet 身份、token、WorkPanel 登录和群绑定 |
| `runners` | 预配置 Runner 与群绑定 |
| `host` | 本站角色、Host 地址、peer、TLS 和签名密钥 |
| `federation` | 跨站策略、签名/TLS、TTL、重试和容量配额 |
| `enrollment` | 一次性接入码、设备凭证 TTL 和静态 token 禁用开关 |
| `retention` | 终态、遥测和审计工作集保留期 |

`host.role` 可为 `connecter`、`host` 或 `standalone`。站点 Connecter 通过 `host.baseUrl/siteId/token` 加入唯一 Connecter Host；Host 通过 `host.peers[]` 预授权站点。生产环境应从 `host.tls.caFile/certFile/keyFile` 与 `host.keys[].secretFile|secretEnv` 加载材料。

`federation` 默认拒绝。生产部署应开启 `requireTls`、`requireSignatures`、`requireSeparateSigningKey` 和 `requireExternalSigningKey`，并先建立精确到 Site、GroupRef、Subject、operation、direction、capability 与 data classification 的 allow 策略。

Runner 契约见 [`protocol/runners.md`](./protocol/runners.md)，Directory 与 enrollment 见 [`protocol/directory-v2.md`](./protocol/directory-v2.md)，联邦配置与信封见 [`protocol/federation-v1.md`](./protocol/federation-v1.md)。

## 校验边界

JSON Schema 用于编辑器提示和离线校验；Relay 启动不强制依赖 AJV。未知字段目前允许，但生产变更仍应先跑 `npm run test:docs` 和 `npm run test:release-local`。
