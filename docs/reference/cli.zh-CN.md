# Connecter 运维 CLI

[English](cli.md) · [简体中文](cli.zh-CN.md)

> 状态：当前 CLI 参考；更新于 2026-08-22。

`npm start` 启动兼容的交互式 CLI。它读取 `config/servers.json`；文件不存在时会从 `config/servers.example.json` 创建。

| 命令 | 状态 | 行为 |
|---|---|---|
| `/chat {server} /{team}` | 已实现 | 向目标群组配置的协调 Agent 投递 prompt |
| `/show-server` | 已实现 | 显示最近 refresh 的服务可达性 |
| `/show-team {server} [/{team}]` | 已实现 | 列出群组或显示一个群组 |
| `/refresh` | 已实现 | 重新探测服务和协调 Agent |
| `/show-log [N]` | 已实现 | 显示最近 N 条调度记录，默认 10 条 |
| `/restart-server` | Stub | 返回 `not implemented`，不会重启服务 |
| `/obs {server} [{team}]` | Stub | 返回 `not implemented`；HTTP 可观测入口见 [`observability.md`](../observability.md) |

CLI 不是跨站身份或 membership 的权威来源；这些职责属于 Site Connecter、Directory 和 Connecter Host。

```powershell
npm start
npm test
```
