# WorkPanelConnecter 全文档一致性审查

Date: 2026-08-22  
Research object: `linlisWorkTeam/workpanelConnecter`, branch `codex/connecter-p0-p3`, baseline `d73e5c6` plus this audit change.  
Evidence: repository source, `config/relay.schema.json`, `package.json`, `src/relay/server.js`, protocol handlers, migrations, v0.2.2 artifacts and v0.2.3 test/build output.

## 结论

审查覆盖仓库全部 Markdown 文档。原先存在四类主要漂移：早期纯 CLI/协调 Agent 架构被当成当前规范；E3 federation 被写成未实现；E1/E2/P0–P3 已完成项仍出现在“下一步”；Windows 构建仍被写成用户本地任务。权威架构、边界、Roadmap、NEXT、API、部署和 WorkPet 文档已按代码重写或修正；历史材料增加快照声明；第三方许可正文未修改。

新增 `npm run test:docs`，把链接、命令、路由覆盖和已知陈旧表述纳入发布门禁。该门禁保证结构性一致，不替代对业务语义的人工审查。

## 处理原则

- 当前规范直接修正；
- 已实现设计记录保留设计推理并指向当前契约；
- 历史计划、release、canary 和交接记录不改写历史事实，只增加时间/权威边界；
- Live2D 第三方 license/notice 保持原文；
- 环境相关地址、凭证、群 ID 和在线状态只作为 dated evidence，不宣称当前仍有效。

## 逐文件审查记录

| 文件 | 分类 | 审查结果 / 处理 |
|---|---|---|
| `README.md` | 当前 | 更新到 51 门禁、Windows 产物和文档入口 |
| `AGENTS.md` | 内部指令 | 命名/epitaph/知识库规则与当前流程一致 |
| `deploy/README.md` | 当前 | 移除 E3 未实现；区分当前 `:8082` 与历史 `:8081` |
| `apps/workpet/README.md` | 当前 | 跨站改为经本站 Connecter；补 NSIS/自动发布 |
| `apps/workpet/third-party/live2d/README.md` | 第三方说明 | 路径与许可引用核对 |
| `apps/workpet/third-party/live2d/CubismWebSamples-LICENSE.md` | 第三方不可改 | 原文保留 |
| `apps/workpet/third-party/live2d/CubismWebSamples-NOTICE.md` | 第三方不可改 | 原文保留 |
| `docs/README.md` | 当前 | 新增权威索引与冲突顺序 |
| `docs/DOCUMENTATION-AUDIT.md` | 当前 | 本报告 |
| `docs/architecture.md` | 当前 | 从旧纯 CLI 架构重写为 Site/Host/Runner federation |
| `docs/scheduling-boundaries.md` | 当前 | 重写角色、数据权威和调度不变量 |
| `docs/api-relay.md` | 当前 | 补 Directory v2、credential、federation、ops 接口入口 |
| `docs/relay-config.md` | 当前 | schema、TLS、签名、retention 与代码一致 |
| `docs/relay-operations.md` | 当前 | 迁移与数据库操作路径核对 |
| `docs/connecter-cli.md` | 当前 | CLI 命令与 reserved `/obs`、`/restart-server` 核对 |
| `docs/protocol/runners.md` | 当前 | register/heartbeat/poll/ack/renew/result 与 lease 契约核对 |
| `docs/protocol/directory-v2.md` | 当前 | Subject/Endpoint/enrollment/credential 路径核对 |
| `docs/protocol/federation-v1.md` | 当前 | envelope、ack/result、目录与安全边界核对 |
| `docs/protocol/identifiers.md` | 当前 | Site/Subject/GroupRef/trace 稳定性核对 |
| `docs/P0-P3-IMPLEMENTATION-STATUS.md` | 当前 | 更新到 51 门禁及文档门禁 |
| `docs/ROADMAP.md` | 当前 | 重写为 P0–P3 已完成、P4 实机验收、P5 adapter |
| `docs/NEXT-DEV-PATH.md` | 当前 | 移除 E1/E2/E3 待开发叙述，改为部署验收优先 |
| `docs/CONNECTER-EVOLUTION.md` | 当前 | 重写为已完成演进与按规模触发 HA |
| `docs/security-review.md` | 当前 | 默认拒绝、签名、mTLS 与 remaining deployment gate 核对 |
| `docs/observability.md` | 当前 | metrics/trace/audit 路径核对 |
| `docs/runbooks/backup-restore.md` | 当前 | backup/restore 命令与脚本核对 |
| `docs/runbooks/federation-local-lab.md` | 当前 | 三进程拓扑与测试脚本核对 |
| `docs/runbooks/federation-recovery.md` | 当前 | outbox/requeue/恢复接口核对 |
| `docs/runbooks/on-call.md` | 当前 | health detail、trace、阈值边界核对 |
| `docs/runbooks/rolling-upgrade.md` | 当前 | 迁移和兼容矩阵核对 |
| `docs/runbooks/security-incident.md` | 当前 | peer/credential revoke/rotate 路径核对 |
| `docs/workpet-config-sample.md` | 当前 | Tauri 配置位置和字段核对 |
| `docs/workpet-e2e-checklist.md` | 历史验收 | 补 v0.2.2 安装冒烟与可见渲染边界 |
| `docs/workpet-live2d-design.md` | 已实现设计 | 指向当前 WorkPet 构建/安装说明 |
| `docs/workconnector-system-design.md` | 历史设计 | 取消“当前规范”声明，保留 N1–N3 追溯 |
| `docs/workpet-connecter-design.md` | 历史设计 | 标记被当前架构/federation 扩展 |
| `docs/bridge-deepseek-harness.md` | adapter 快照 | 区分通用 Runner 已实现与真实 dsh bridge 未实现 |
| `docs/mvp-status-and-acceptance.md` | 历史验收 | 标记早期 MVP 快照 |
| `docs/HANDOFF-codex-goal.md` | 历史交接 | 标记非当前任务清单 |
| `docs/WP-E2-COLLAB.md` | 历史协作 | 标记 dated 跨仓证据 |
| `docs/canary-mvp-2026-08-05.md` | 历史验证 | 标记环境快照 |
| `docs/canary-workpet-relay-2026-08-06.md` | 历史验证 | 标记环境快照 |
| `docs/canary-wp-live-2026-08-05.md` | 历史验证 | 标记环境快照 |
| `docs/releases/v0.2.0.md` | release 快照 | 保留当时 48 门禁和 evidence boundary |
| `docs/releases/v0.2.1.md` | release 快照 | 保留当时 49 门禁和 mTLS 增量 |
| `docs/releases/v0.2.2.md` | release 快照 | Windows 二进制交付与 50 门禁证据 |
| `docs/releases/v0.2.3.md` | release 快照 | 全文档审查、51 门禁与 Windows 二进制交付 |
| `docs/epitaph/README.md` | 交接索引 | 新增本轮 active 交接 |
| `docs/epitaph/2026-08-22-documentation-audit.md` | 当前交接 | 固化本轮架构、门禁与剩余部署证据 |
| `docs/epitaph/2026-08-19-workpet-connected-space.md` | 历史交接 | 标注后续 federation 已实现 |
| `docs/epitaph/2026-08-20-workpet-appearance-login.md` | 历史交接 | 标注后续 federation 已实现 |
| `docs/superpowers/specs/2026-08-05-workpet-connecter-design.md` | 历史设计 | 增加当前权威入口 |
| `docs/superpowers/specs/2026-08-19-connecter-host-naming-design.md` | 有效决定 | 保留命名，更新 federation 状态 |
| `docs/superpowers/specs/2026-08-19-e2-pluggable-runner-design.md` | 已实现设计 | 指向 Runner 协议 |
| `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md` | 已实现设计 | 指向当前 API |
| `docs/superpowers/specs/2026-08-19-workpet-live2d-swap-design.md` | 已实现设计 | 指向 WorkPet README |
| `docs/superpowers/specs/2026-08-19-workpet-sprite-customize-design.md` | 已实现设计 | 指向 WorkPet README |
| `docs/superpowers/specs/2026-08-19-workpet-xiaoai-announce-design.md` | 已实现设计 | 指向当前测试行为 |
| `docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md` | 历史计划 | 标记 checkbox 非当前缺口 |
| `docs/superpowers/plans/2026-08-19-e2-pluggable-runner.md` | 历史计划 | 指向 Runner 协议 |
| `docs/superpowers/plans/2026-08-19-workpet-group-console.md` | 历史计划 | 指向 WorkPet/API 当前行为 |
| `docs/superpowers/plans/2026-08-19-workpet-sprite-customize.md` | 历史计划 | 指向 WorkPet 当前行为 |
| `docs/superpowers/plans/2026-08-19-workpet-xiaoai-announce.md` | 历史计划 | 指向当前测试行为 |
| `docs/superpowers/plans/2026-08-21-connecter-p0-p3-evolution.md` | 已完成计划 | 保留为 P0–P3 验收来源 |

## 建议

1. 新功能 PR 必须同时运行 `npm run test:docs`；
2. 当前规范不写机器特定 token、群 ID 或在线结论；
3. dated evidence 必须带日期、commit/环境和证据边界；
4. 新 design/plan 完成后必须加“已实现设计记录”或“历史计划”状态；
5. 真正生产就绪仍需双 Site + 独立 Host mTLS、外部告警和 72 小时 soak。

## 证据边界

本次审查能证明仓库文档与当前源代码、schema、命令和本地/CI 证据一致；不能证明外部机器、证书、WorkPanel 实例或历史 URL 仍在线。第三方许可文本未进行法律意见审查，只验证仓库中的许可文件和引用仍存在。
