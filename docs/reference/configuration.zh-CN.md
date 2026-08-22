# 配置参考

[English](configuration.md) · [简体中文](configuration.zh-CN.md)

机器可读定义见 [`config/relay.schema.json`](../../config/relay.schema.json)，脱敏样例见 [`config/relay.example.json`](../../config/relay.example.json)。真实 `config/relay.json` 已被 Git 忽略。禁止提交凭证、私钥或签名密钥。

| 字段 | 用途 |
|---|---|
| `listen` | HTTP 监听；可由 `CONNECTER_RELAY_HOST` 和 `CONNECTER_RELAY_PORT` 覆盖 |
| `publicBaseUrl` | Runner 任务和心跳响应中的 URL 前缀 |
| `db.path` | SQLite 文件路径 |
| `auth.tokens` | 运维 API Bearer token |
| `allowProdFromPet` | 是否允许 WorkPet 访问 `prod` |
| `rateLimitPerMin` | WorkPet 每分钟请求限额，默认 60 |
| `backends` | 环境名到 WorkPanel HTTP 槽位的映射 |
| `defaults` | 缺省环境、群组和协调 Agent |
| `pets` | WorkPet 身份、token、WorkPanel 凭证和群组绑定 |
| `runners` | 预配置 Runner 和群组绑定 |
| `host` | Site 或 Host 角色、peer 地址、TLS 和签名材料 |
| `federation` | 跨站策略、签名/TLS、重试、TTL 和配额设置 |
| `enrollment` | 一次性接入码和设备凭证 TTL |

`host.role` 可以是 `connecter`、`host` 或 `standalone`。生产部署应从外部文件或环境变量加载 TLS 和签名材料，并明确审查 federation 策略。

完整字段行为见 [`relay-config.md`](../relay-config.md)。Runner、Directory 和 Federation 契约见 [`protocol/`](../protocol/)。
