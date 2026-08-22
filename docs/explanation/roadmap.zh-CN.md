# 路线图

[English](roadmap.md) · [简体中文](roadmap.zh-CN.md)

路线图使用预估季度，不写死交付日期。正式计划不是承诺；当证据、资源或依赖变化时，应将条目移入 Backlog。

## 已交付基线

- v0.2.x：Site Connecter、Runner lease 与 fencing、Directory v2、enrollment、durable federation、签名和 mTLS 客户端支持已在本地证据边界内实现；
- v0.2.3：已提供 WorkPet NSIS 安装器、Connecter Windows 便携包、校验文件和文档/发布门禁。

## 正式计划

### v0.3.x — 预计 2026 年第三季度

- 证明真实双站点与独立 Connecter Host 的部署；
- 完成生产 CA/mTLS 运维、密钥轮换、外部告警和长时间 soak 证据；
- 为发布产物完成 Windows Authenticode 签名。

### v0.4.x — 预计 2026 年第四季度

- 定义稳定的适配器契约，支持更多 WorkPanel 兼容后端；
- 根据真实用户验证改进 WorkPet 首次配置和更新指南。

## Backlog — 待评估

- 当单 Host 边界成为经测量的瓶颈后，再评估 Host 高可用、外部数据库/队列或基于 Raft 的协调；
- 当轮询不再满足需求时，评估 WebSocket 或 SSE；
- 在完成契约和安全边界审查后，评估更多 A2A/ACP 适配器集成。

## 维护规则

- 只使用预估季度，不把精确日期写成承诺；
- 将正式计划与 Backlog 分开；
- 每个已交付条目都应链接代码、测试或发布证据；
- 完成后移入已交付基线，延期条目记录原因；
- 修改季度前先与维护者确认。

<!-- TODO: 根据项目实际确认每个正式计划条目的负责人和季度。 -->
