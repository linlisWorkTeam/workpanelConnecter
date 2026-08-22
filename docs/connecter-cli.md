# Connecter 运维 CLI

> 状态：当前 CLI 参考；更新于 2026-08-22。

WorkPanelConnecter 产品由站点/Host HTTP Relay、Runner 协议、WorkPet UI 和运维 CLI 组成。本页只描述 `npm start` 启动的兼容 CLI，不再把“纯 CLI”视为整个产品架构。

| 命令 | 当前状态 | 行为 |
|---|---|---|
| `/chat {server} /{team}` | 已实现 | 向已配置服务的目标群协调 Agent 投递 prompt |
| `/show-server` | 已实现 | 显示最近 refresh 的服务可达性 |
| `/show-team {server} [/{team}]` | 已实现 | 列出群或显示群详情 |
| `/refresh` | 已实现 | 重新探测服务与协调 Agent |
| `/show-log [N]` | 已实现 | 显示最近 N 条调度记录，默认 10 |
| `/restart-server` | 保留 stub | 返回 `not implemented`，不执行重启 |
| `/obs {server} [{team}]` | 保留 stub | 返回 `not implemented`；HTTP 可观测入口见 [`observability.md`](./observability.md) |

CLI 的补全词表来自本地配置和最近一次 refresh。服务/群可用 ID 或显示名查找；离线目标不会被 `/chat` 正常调度。CLI 不解析 prompt 领域语义，也不是跨站身份或 membership 的权威来源；这些职责属于 Site Connecter、Directory 与 Connecter Host。

启动与基本验证：

```powershell
npm start
npm test
```

HTTP Relay 使用 `npm run relay`，生产 API 与鉴权见 [`api-relay.md`](./api-relay.md)。
