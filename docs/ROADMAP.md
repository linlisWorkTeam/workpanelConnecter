# WorkPanelConnecter — Roadmap

> 日期：2026-08-04
> 依据：群聊愿景 + `architecture.md` + `connecter-cli.md` + `scheduling-boundaries.md`

## ⚡ 2026-08-06 更新：中继 + WorkPet MVP 全部落地 ✅

> 新架构（冻结设计 D1–D16 + 系统设计 N1–N3）：Connecter = 稳定中继（nginx :80 → :9080 systemd），WorkPet = 同仓 Tauri 猫猫球。实现路径见 `docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md`。

| Phase | 内容 | 状态 |
|-------|------|------|
| 0–1 | 中继核：router/auth/handlers、配置、`test:relay` | ✅ 完成（`4b29ca9`） |
| 1.5 | SQLite 落库 + 配置式注册 + 轮询回显 + 幂等/死信/吊销 | ✅ 完成（`4b29ca9`） |
| 2 | systemd :9080 + nginx :80 反代（方案 B / D16） | ✅ 已上线（`fb6c49d`） |
| 3 | WorkPet 猫猫球（Tauri 2 壳 + JS SDK） | ✅ 完成（`ac17952`，桌面构建留用户本地） |
| 4 | E2E 验收 E1–E8 + 灰度记录 | ✅ 全部通过（见 `docs/workpet-e2e-checklist.md`、`docs/canary-workpet-relay-2026-08-06.md`） |
| 5 | 二期：WP 回连/WS/动态注册/多适配器/443 T2 | ⏳ 未开始 |

## 2026-08-07 更新：WorkPet Live2D 改造

> 原 Phase 3 静态猫猫球保留为兼容降级，不再是主视觉。设计见 `docs/workpet-live2d-design.md`。

| 子阶段 | 内容 | 状态 |
|---|---|---|
| 3.1-a | Live2D 技术、资源许可、状态映射、窗口与降级设计 | ✅ 完成 |
| 3.1-b | Live2D 渲染适配层与新桌宠 UI | ✅ 完成 |
| 3.1-c | 模型资源准备、配置样例与许可 Notice | ✅ 完成 |
| 3.1-d | 前端测试、Tauri 构建、透明窗口视觉验收 | ✅ 完成（Windows / WebView2） |

## 角色分工（2026-08-06 更新）

| 角色 | 职责 |
|------|------|
| **OpenClaw** | 开发负责人（2026-08-06 起，root 指令「接下来就你负责开发」）；设计/实现/门禁/部署 |
| **cs** | Phase 0–1.5 实现（已移交）；后续按需协助 |
| **codex** | 搁置（工具调用通道故障，恢复条件=至少一次真实命令执行成功） |


## 开发节奏（锁定）

1. **先设计文档，再 Roadmap** ← cs 已交初稿  
2. **先实现 Connecter**，再写 **API 文档 + WorkPanel 对接文档**（明确 WP 侧必须实现的能力）

## 阶段总览

| 阶段 | 名称 | 产出 | 状态 | Owner |
|------|------|------|------|-------|
| **A** | 设计定稿 | 架构 / CLI / 边界 / Roadmap | **已定稿** | cs（收口完成） |
| **B** | Connecter MVP | 可运行 CLI：命令见设计 | **MVP 骨架已落地（cs）** | **cs**（临时） |
| **C** | 契约与对接 | A2A / `team_metadata` / API / WP 对接清单 | 未开始（依赖 B） | **codex**（文档可与 cs 协同） |
| **D** | WorkPanel 协调 Agent | 每 WP 单协调 Agent | 在 WP 仓 | WP 仓 + 对接文档驱动 |
| **E** | 联调与硬化 | 跨服务 E2E | 未开始 | **codex** |
| **F** | 预留能力 | `/restart-server`、`/obs` | 明确延后 | **codex** |

## 阶段 A — 设计定稿（已定稿）

**已交付**

- [x] `docs/architecture.md`
- [x] `docs/connecter-cli.md`
- [x] `docs/scheduling-boundaries.md`
- [x] `docs/ROADMAP.md`

**冻结决策（2026-08-04）**

| 项 | 决定 |
|----|------|
| `/show-team` | `/show-team {服务} [/{群组}]` |
| 服务发现（MVP） | **静态配置文件**（**JSON**：`config/servers.json`）；`/refresh` 对配置项做可达性探测 |
| 协调不可用 | 调度失败，不旁路工作 Agent |

**退出准则**：已满足 → 进入阶段 B。

## 阶段 B — Connecter MVP（cs 临时编码）

**范围**

- CLI 骨架与斜杠命令路由
- 本地服务目录 + `/refresh` 探测
- `/show-server`、`/show-team`
- `/chat` → 仅调用目标协调 Agent（可用 mock 协调端先行）
- `/show-log`（默认 10）
- `/restart-server`、`/obs`：**解析 +「未实现」**，不写业务逻辑

**不做**

- 网页
- 直连工作 Agent
- 完整观测后端、远程重启

**Done when**：本地配置 1–2 个 mock/真协调端，可完成一次 `/chat` 并在 `/show-log` 看到记录。

**进度（2026-08-04 cs）**

- [x] Node CLI 骨架 + 斜杠命令路由（`bin/connecter.js` / `src/cli.js`）
- [x] 静态 JSON 配置 + `/refresh` 探测
- [x] `/show-server` `/show-team` `/chat` `/show-log`；`/restart-server` `/obs` 占位
- [x] mock 协调端 + **自包含门禁** `npm test`（`SMOKE_OK`/`GATE_OK`）
- [x] **现状与验收标准** → `docs/mvp-status-and-acceptance.md`（2026-08-05）
- [x] 核心改动：门禁硬断言（在线成功/离线失败/stub/team_metadata）+ `cmdChat` 静态导入整理
- [x] **灰度验证记录** → `docs/canary-mvp-2026-08-05.md`（mock）+ `docs/canary-wp-live-2026-08-05.md`（**真实 :8081，无 mock**）
- [x] WorkPanel 适配器：`kind=workpanel` → `/api/health` + 群 `@` 调度；`npm run test:canary` = `CANARY_GATE_OK`

## 阶段 C — API 与对接文档

**范围**

- A2A 消息与 Agent Card 的 `team_metadata` 正式 schema
- Connecter → 协调 Agent 的调用序列、错误码、超时/重试
- WorkPanel 必须实现的清单：单协调 Agent 部署约束、健康检查、对内调度钩子、状态聚合
- 验收用例（跨服务消息、协调不可用失败、对内拆解不暴露给 Connecter）

**Done when**：WP 侧可按文档独立开工，无需翻群聊。

## 阶段 D — WorkPanel 协调 Agent

- 在 WorkPanel 仓实现；Connecter 仓只保留契约测试客户端（若需要）
- 约束：一 WP 一协调 Agent；算法非 AI；对外 A2A，对内原生机制

## 阶段 E — 联调

- A↔B 两服务两群组真实路径
- 补全、刷新、失败路径与日志字段打磨
- 权限/鉴权按 C 阶段文档落地

## 阶段 F — 预留命令

- `/restart-server`、`/obs` 在安全模型清晰后实现

## 明确非目标（全阶段）

- 新建 AT2AT 协议
- Connecter 网页端
- Connecter 实现业务 Agent / 业务功能
- 协调 Agent 不可用时旁路到工作 Agent

## 建议的立刻下一步

1. **@codex** 已收到 Goal 交接：`docs/HANDOFF-codex-goal.md`  
2. 按 `docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md` 从 **Task 0.1** 启动 Goal 模式实施  
3. cs 待命文档协助；避免与 codex 双写同一文件  

> 2026-08-06：用户指令「让 codex 启动 goal 模式做这个事情」。
