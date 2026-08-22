# Roadmap

本路线图只记录方向和维护者已确认的计划。季度是预估，不是承诺日期；具体发布内容以版本、CHANGELOG 和发布门禁为准。

## 已发布

### v0.2.x

- Site Connecter Relay、Runner lease/fencing、Directory v2、enrollment、durable federation 和安全运维能力已在本地证据边界内实现。
- WorkPet 安装器、Connecter 便携包和文档门禁已提供。

详情见 [`../P0-P3-IMPLEMENTATION-STATUS.md`](../P0-P3-IMPLEMENTATION-STATUS.md) 和 [`../../CHANGELOG.md`](../../CHANGELOG.md)。

## 正式计划

### v0.3.x（预计 2026 Q3，待维护者确认）

- 完成真实双 Site + 独立 Host 的网络部署验收。
- 完成生产 CA/mTLS、密钥轮换、外部告警和长时 soak 证据。
- 完成 Windows Authenticode 签名所需的发布流程。

### v0.4.x（预计 2026 Q4，待维护者确认）

- 评估统一 Runner/WorkPanel/其他 runtime 的 adapter contract。
- 改善 WorkPet 首次配置、更新和安装体验。

## Backlog（待评估）

- Host HA、外置数据库/队列或 Raft/etcd；只有单 Host 成为实际 SLA/容量瓶颈时再评估。
- WebSocket/SSE；当前 `since` 轮询仍是兼容接口。
- 更多 A2A/ACP runtime 适配器。

## 维护规则

- 新增项目必须放入“正式计划”或“Backlog”，不得混写。
- 正式计划只写预计季度，不写死发布日期。
- 已完成事项必须有代码、测试或发布证据链接。
- 版本发布后同步更新 `CHANGELOG.md`，并把未完成项目移回正确的计划区。

<!-- TODO: 根据项目实际补充维护者确认的版本目标和季度。 -->
