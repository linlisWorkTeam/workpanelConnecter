# WorkPanelConnecter — Roadmap

> 更新：2026-08-19（E2 可插拔 Runner 设计启动；dsh 延后到 E4）  
> 规范：`docs/workconnector-system-design.md` · 设计：`docs/workpet-connecter-design.md` · 下一步：`docs/NEXT-DEV-PATH.md` · 演进：`docs/CONNECTER-EVOLUTION.md`

## MVP 状态：Phase 0–4 已完成 ✅

| Phase | 内容 | 状态 | Commit / 证据 |
|-------|------|------|----------------|
| 0–1 | 中继核 | ✅ | `4b29ca9` |
| 1.5 | SQLite + 配置 pets + 轮询/幂等 | ✅ | `4b29ca9` |
| 2 | systemd `:9080` + nginx `:80` | ✅ | `fb6c49d` |
| 3 | WorkPet Tauri + SDK | ✅ | `ac17952`（桌面编包留用户本机） |
| 4 | E2E E1–E8 | ✅ | `f7db1bc` · `docs/workpet-e2e-checklist.md` |
| **5** | 二期（见 NEXT） | ⏳ | `docs/NEXT-DEV-PATH.md` |

## 2026-08-19：E1–E4 主线（调度演进）

> Runner **可插拔**，不绑定 DSH。完整 ACP / 真 Harness 不在 Connecter 内做。E4 达线后再由 dsh 用同一 `/v1/agents/*` 自举。

| 阶段 | 内容 | 状态 | 证据 / 规格 |
|------|------|------|-------------|
| **E1** | 出站注册 / 心跳 / 拉任务 / 回结果 | ✅ 代码骨架 | `6b6b4f6` · `src/relay/runners.js` · `docs/api-relay.md` §5 |
| **E2** | 通用 Runner 槽 + 串行/TTL + `/v1/messages` 全文 + canary 实调用验收 | ✅ | `docs/superpowers/specs/2026-08-19-e2-pluggable-runner-design.md` |
| **E3** | Team↔Team：非 AI 协调门面、跨 WP、审计 | ⏳ 未开始 | 依赖 WP 仓；Connecter 只做中继侧 |
| **E4** | 中继 HA（可选）；dsh 作为一种 Runner 接手自举 | ⏳ 远期 | 不做完整 Raft「为用而用」 |

**当前下一刀：E2 中继已合入；生产部署 wp-runner 需另批。E3/E4 未开始。**

## 2026-08-07 更新：WorkPet Live2D 改造

> 原 Phase 3 静态猫猫球保留为兼容降级，不再是主视觉。设计见 `docs/workpet-live2d-design.md`。

| 子阶段 | 内容 | 状态 |
|---|---|---|
| 3.1-a | Live2D 技术、资源许可、状态映射、窗口与降级设计 | ✅ 完成 |
| 3.1-b | Live2D 渲染适配层与新桌宠 UI | ✅ 完成 |
| 3.1-c | 模型资源准备、配置样例与许可 Notice | ✅ 完成 |
| 3.1-d | 前端测试、Tauri 构建、透明窗口视觉验收 | ✅ 完成（Windows / WebView2） |

## 角色

| 角色 | 职责 |
|------|------|
| **cs** | 文档同步、路径规划；实现按群指令继续（codex 搁置期间） |
| **codex** | 搁置（工具通道故障）；恢复条件=至少一次真实命令成功 |
| **用户 / 本机** | WorkPet 桌面构建与公网 TLS 决策 |

## 早期阶段表（A–F，历史）

| 阶段 | 名称 | 现状 |
|------|------|------|
| A 设计 | 已定稿 | ✅ |
| B Connecter CLI/中继 MVP | 已并入 Phase 0–4 | ✅ |
| C API/对接文档 | **P0.2 已交付** `docs/api-relay.md` | ✅ |
| D WP 协调 Agent | WP 仓；门面暂用群 admin Agent | ⏳ |
| E 联调 | E1–E8 已过；跨实例增强在 Phase 5b | 部分 ✅ |
| F 预留命令 | `/obs` `/restart-server` | 延后 |

## 建议的立刻下一步

见 **`docs/NEXT-DEV-PATH.md`** 与 **`docs/CONNECTER-EVOLUTION.md`**：

1. **E2** 可插拔 Runner 闭环（主线，cs）  
2. P0.1 本机 WorkPet 冒烟（用户）  
3. P1 CORS/HTTPS 已部分落地；外网 443 仍可能被云侧丢掉  
4. E3 / E4 不插入 E2 之前

## 非目标（锁定）

- 新建 AT2AT；Connecter 业务网页/业务 Agent；默认 prod；旁路工作 Agent；Connecter 自建产/灰双槽  
