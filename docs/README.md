# WorkPanelConnecter 文档索引

> 更新：2026-08-22。代码与测试是最终事实源；本文规定文档的权威顺序和历史边界。

## 当前权威入口

| 主题 | 文档 |
|---|---|
| 产品拓扑与模块 | [`architecture.md`](./architecture.md) |
| 调度/职责边界 | [`scheduling-boundaries.md`](./scheduling-boundaries.md) |
| HTTP API | [`api-relay.md`](./api-relay.md) |
| 配置 | [`relay-config.md`](./relay-config.md) |
| Runner | [`protocol/runners.md`](./protocol/runners.md) |
| Directory/身份 | [`protocol/directory-v2.md`](./protocol/directory-v2.md), [`protocol/identifiers.md`](./protocol/identifiers.md) |
| 跨站联邦 | [`protocol/federation-v1.md`](./protocol/federation-v1.md) |
| 安全与可观测性 | [`security-review.md`](./security-review.md), [`observability.md`](./observability.md) |
| 运维 | [`../deploy/README.md`](../deploy/README.md), [`runbooks/`](./runbooks/) |
| 当前状态与证据边界 | [`P0-P3-IMPLEMENTATION-STATUS.md`](./P0-P3-IMPLEMENTATION-STATUS.md) |
| 后续路线 | [`ROADMAP.md`](./ROADMAP.md), [`NEXT-DEV-PATH.md`](./NEXT-DEV-PATH.md) |
| Windows 安装/构建 | [`../README.md`](../README.md), [`../apps/workpet/README.md`](../apps/workpet/README.md), [`releases/v0.2.2.md`](./releases/v0.2.2.md) |

## 文档类型

- **当前规范**：必须与当前代码、schema 和测试同步；上述权威入口属于此类。
- **已实现设计记录**：解释为什么这样实现，但当前接口以代码/协议文档为准。
- **历史快照**：dated canary、`superpowers/`、旧 HANDOFF、旧 MVP 文档、release note 和旧 epitaph；保留当时语境，不能据此判断当前缺口。
- **第三方不可改正文**：Live2D license/notice，只校验文件仍在且链接有效。
- **内部指令**：`AGENTS.md` 约束协作流程，不是产品契约。

## 权威冲突处理

发生冲突时依次采用：运行代码与 schema → 自动化测试 → 当前协议/架构文档 → 当前运维文档 → 已实现设计记录 → 历史快照。发现冲突必须在同一变更中修正文档或显式声明证据边界。

## 自动门禁

`npm run test:docs` 会检查：

1. 全仓 Markdown 相对链接；
2. 文档引用的 `npm run` 命令是否真实存在；
3. 当前文档是否重新出现已知陈旧状态；
4. 已实现 HTTP 路由是否在 API/协议文档中有入口；
5. 本索引和审计报告是否存在。

逐文件审查结果见 [`DOCUMENTATION-AUDIT.md`](./DOCUMENTATION-AUDIT.md)。
