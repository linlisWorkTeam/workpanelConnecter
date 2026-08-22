# WorkPanelConnecter 架构

> 状态：当前权威架构，适用于 v0.2.3。
> 更新：2026-08-22。代码、协议文档与测试门禁优先于更早的设计稿和实施计划。

## 1. 产品定位

WorkPanelConnecter 是多站点 WorkPanel、WorkPet、User 与远程 Runner/Agent 之间的连接、路由和可靠投递中间件。

- 每个站点部署一台 **Connecter**；
- 全网部署一台中心化 **Connecter Host**；
- WorkPet、WorkPanel 和 Runner 只连接本站 Connecter；
- Connecter Host 只接收站点注册、目录交换和跨站联邦消息；
- 站内消息不绕行 Host，Host 不执行 Agent，也不直接连接 WorkPet 或 WorkPanel。

## 2. 当前拓扑

```text
站内：WorkPet/User ─► Site Connecter ─► WorkPanel / Runner

跨站：WorkPet A ─► Connecter A ─► Connecter Host ─► Connecter B ─► Runner/WorkPanel B
结果：Runner B ─► Connecter B ─► Connecter Host ─► Connecter A ─► WorkPet/WorkPanel A
```

单站开发时，Site Connecter 与 Host 可以在同一进程/机器合署，但角色和接口边界不因此合并。

## 3. 角色与权威边界

| 角色 | 权威数据 | 明确不负责 |
|---|---|---|
| WorkPet | 用户交互、本地外观和连接配置 | 路由、调度、跨站、直接访问 WorkPanel/Host |
| Site Connecter | 本站身份映射、Runner lease、消息/任务持久化、目录投影、联邦 inbox/outbox、WorkPanel 回写 | 执行 Agent、替代 WorkPanel 群聊业务 |
| Connecter Host | Site peer、全局目录视图、跨站中继、联邦策略与配额 | WorkPet API、WorkPanel API、Runner 执行、站内消息 |
| WorkPanel | 群、成员、会话正文和业务 Agent 身份 | 跨站传输与远程 Runner lease |
| Runner/Agent | 实际任务执行和结果 | 群消息权威、跨站路由决策 |

## 4. 数据面与控制面

### 4.1 站内数据面

`POST /v1/chat` 先在 Site Connecter 落盘，再解析稳定 Subject、GroupRef 和目标 Runner/WorkPanel。Runner 通过出站 `poll → ack → renew → result` 循环取任务；lease token、generation 与 fencing 防止过期执行者回写结果。

### 4.2 跨站数据面

源站把联邦信封写入 durable outbox，Host 幂等受理后投递到目标站 inbox；目标站执行并沿相反方向返回终态。TTL、hop limit、幂等键与 first-terminal-wins 防止循环、重复和终态覆盖。Host 数据丢失时，源站会对非终态受理记录重新协调。

### 4.3 控制面

- Directory v2 使用稳定 Subject ID、Endpoint 和 canonical GroupRef；
- enrollment/credential 支持一次性接入、轮换与吊销；
- Host peer 支持注册、心跳、运行时轮换与吊销；
- federation policy 默认拒绝，并按 Site、GroupRef、Subject、operation、direction、capability、dataClassification 判定。

## 5. 代码模块

| 模块 | 主要路径 |
|---|---|
| HTTP 接入与角色边界 | `src/relay/server.js`, `src/relay/handlers.js` |
| 消息与可靠投递 | `src/relay/messaging.js`, `src/relay/delivery.js` |
| Runner lease/任务队列 | `src/relay/runners.js`, `src/relay/services/taskQueueService.js` |
| Directory/路由/接入 | `src/relay/directory.js`, `routeResolver.js`, `enrollment.js`, `credentialStore.js` |
| Site/Host 联邦 | `federationSite.js`, `federationHost.js`, `hostJoin.js`, `services/federationService.js` |
| 安全与审计 | `accessPolicy.js`, `envelopeSignature.js`, `quotas.js`, `auditLog.js`, `telemetry.js` |
| WorkPanel 适配 | `src/workpanelClient.js`, `src/relay/wpSlots.js` |
| WorkPet | `apps/workpet/`（Tauri 2 + Web UI） |
| Windows 发布 | `scripts/build-windows-release.ps1`, `.github/workflows/release-windows.yml` |

## 6. 持久化与恢复

SQLite 使用 WAL 和顺序写事务；迁移文件位于 `src/relay/migrations/`，启动时校验迁移 checksum。消息、run、Runner task、目录、联邦 inbox/outbox、策略、凭证、审计和遥测均有持久化模型。备份、恢复、滚动升级和联邦恢复流程见 `docs/runbooks/`。

## 7. 安全基线

- WorkPet/ops/Runner/Site peer 使用不同凭证与权限边界；
- 生产模式可拒绝静态 Runner token、inline signing secret 和非 TLS Host URL；
- 联邦信封支持签名轮换，Site 到 Host 支持验证服务端证书的 mTLS；
- 配置、证书、签名密钥和 SQLite 数据均不得进入 Git；
- Windows v0.2.3 二进制尚未 Authenticode 签名，SmartScreen 可能提示未知发布者。

## 8. 当前证据边界

`npm run test:release-local` 包含 51 项本地门禁；本地三进程联邦、故障恢复、真实临时 CA mTLS 和 WorkPanel canary 已验证。真实双 Site + 独立 Host 网络部署、生产证书运维、外部告警接收器和 72 小时 soak 仍是部署环境门禁，因此当前版本不能表述为“生产就绪”。

## 9. 权威文档

- HTTP API：[`api-relay.md`](./api-relay.md)
- Runner：[`protocol/runners.md`](./protocol/runners.md)
- Directory：[`protocol/directory-v2.md`](./protocol/directory-v2.md)
- Federation：[`protocol/federation-v1.md`](./protocol/federation-v1.md)
- 配置：[`relay-config.md`](./relay-config.md)
- 实现状态：[`P0-P3-IMPLEMENTATION-STATUS.md`](./P0-P3-IMPLEMENTATION-STATUS.md)
- 文档状态索引：[`README.md`](./README.md)
