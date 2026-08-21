# MVP Connecter — 现状与验收标准

> 文档状态：早期 MVP 验收快照。当前能力已经扩展到 P0–P3 federation，权威状态见 `P0-P3-IMPLEMENTATION-STATUS.md`。

> 任务：路线图闭环 · MVP版本Connecter · 实施 · **梳理现状与验收标准**  
> 日期：2026-08-05  
> 范围：仅 Connecter 仓 MVP（阶段 B）；不含真实 A2A / WP 协调 Agent 生产实现（阶段 C/D）

## 1. 项目定位（群公告）

本项目解决 **多 WorkPanel 间交互**：跨服务/跨群组协同调度。  
Connecter = **纯 CLI 调度平面**；只与各 WP 上的 **协调 Agent** 交互；不做业务、无网页端。

## 2. 现状梳理

### 2.1 已完成

| 项 | 状态 | 位置 |
|----|------|------|
| 架构 / CLI / 边界 / Roadmap 设计 | 已定稿 | `docs/architecture.md` 等 |
| 冻结：`/show-team {服务} [/{群组}]` | 是 | `docs/connecter-cli.md` |
| 冻结：MVP 静态配置 + `/refresh` 探测 | 是（实现为 **JSON**，非 YAML） | `config/servers*.json` |
| Node CLI 骨架与斜杠命令 | 已落地 | `bin/connecter.js` `src/cli.js` |
| `/chat` `/show-server` `/show-team` `/refresh` `/show-log` | 已实现 | `src/commands.js` |
| `/restart-server` `/obs` | 仅占位（返回 not implemented） | `src/cli.js` |
| 只连协调端；不可用则失败 | 已实现 | `src/coordinator.js` |
| Mock 协调 Agent | 已有 | `mock/coordinator-server.js` |
| 冒烟脚本 | 已有 | `scripts/smoke.js` / `npm run smoke` |
| 调度记录 | 本地 JSONL | `~/.connecter/dispatch.jsonl`（可 `CONNECTER_DATA`） |

### 2.2 未完成 / 非 MVP

| 项 | 说明 |
|----|------|
| 真实 A2A 协议 | 现为 HTTP mock（`/health` `/agent-card` `/tasks`） |
| WorkPanel 侧真实协调 Agent | 阶段 D；本仓不实现业务 Agent |
| `/restart-server` `/obs` 真功能 | 明确延后（阶段 F） |
| 注册中心式服务发现 | MVP 不用 |
| 鉴权 | MVP 可无 |
| 首次 git commit | 仓库仍 **No commits yet** |
| 补全体验打磨、双 mock 联调 | 可选加强，不阻塞「MVP 可验收」底线 |

### 2.3 技术栈事实

- 运行时：Node >= 18（零 npm 依赖）
- 配置：`CONNECTER_CONFIG` 或 `config/servers.json`
- 入口：`npm start` / `node bin/connecter.js`

## 3. MVP 验收标准（Definition of Done）

以下全部满足 ⇒ **MVP版本Connecter 可判定通过**。

### 3.1 功能验收（必须）

| # | 标准 | 如何验 |
|---|------|--------|
| A1 | 能加载静态服务/群组配置 | 存在 `config/servers.json`（或从 example 拷贝）后 CLI/smoke 可启动 |
| A2 | `/refresh`（或启动探测）更新在线状态 | mock 在线显示 yes；未启动显示 no |
| A3 | `/show-server` 列出服务及 online | 人工或 smoke 输出含 ID/NAME/ONLINE |
| A4 | `/show-team {服务}` 列出该服务群组 | 同上 |
| A5 | `/show-team {服务} /{群组}` 可见协调摘要/`team_metadata`（有 card 时） | mock 返回 agent-card 后可见 JSON |
| A6 | `/chat {服务} /{群组}` + prompt 仅打协调 Agent | 成功时有 taskId/status；流量不直连 worker |
| A7 | 协调 Agent 不可用 ⇒ 调度失败，有明确失败信息 | 停掉目标 mock 后 `/chat` 失败文案含 unavailable |
| A8 | `/show-log` 默认 10 条；可带次数 | 成功/失败记录均可查 |
| A9 | `/restart-server`、`/obs` 可解析且声明未实现 | 输入命令返回 reserved/not implemented |
| A10 | 无网页端；无业务 UI | 仓库无 web 前端 |

### 3.2 自动化验收（必须）— 测试门禁

门禁自包含：自动拉起 mock A（`:19001`）、硬断言、退出时回收进程。

```bash
npm test
# 等价：npm run smoke / npm run gate
# 必须输出 SMOKE_OK 与 GATE_OK，exit 0
```

覆盖：refresh、show-server、show-team（含 team_metadata）、成功 `/chat`、离线失败、`/show-log`、占位命令 stub。  
可选：`CONNECTER_SMOKE_EXTERNAL_MOCK=1` 时不自启 mock（沿用外部进程）。

### 3.3 边界验收（必须）

| # | 标准 |
|---|------|
| B1 | Connecter 不解析业务 prompt 语义（透传） |
| B2 | 不提供旁路到工作 Agent 的路径 |
| B3 | 文档声明：跨 WP 交互经协调 Agent（见 `docs/scheduling-boundaries.md`） |

### 3.4 明确不纳入本 MVP 验收

- 真实 A2A / Agent Card 生产兼容
- WorkPanel 生产/灰度部署与重启
- `/obs` 统计数据源
- 多租户鉴权与权限模型

## 4. 当前对照结论（2026-08-05）

| 结论 | 说明 |
|------|------|
| **功能与边界：达到 MVP 底线** | A1–A10、B1–B3 在代码与文档上已具备 |
| **自动化：以 `npm run smoke` 为准** | 需本地起 mock；历史上已通过 `SMOKE_OK` |
| **缺口（不挡 MVP 底线）** | 无 git commit；契约仍为 mock HTTP；补全/双 mock 未硬化 |

**MVP 实施下一动作建议**（非本任务范围）：按 §3.2 固化回归；需要时再开「对接真实协调契约」或阶段 C 文档。

## 5. 验收检查清单（可打勾）

- [x] `npm test` → `SMOKE_OK` / `GATE_OK`（自包含门禁，2026-08-05）
- [ ] 交互：`npm start` 下 `/show-server` `/chat` `/show-log` 各跑通一次（人工，非门禁阻塞）
- [x] 对离线 B `/chat` → 失败且无 worker 旁路（门禁断言）
- [x] `/restart-server`、`/obs` → not implemented（门禁断言）
- [x] 确认无网页端、配置为静态 JSON

## 6. 实施任务结论

- **梳理现状与验收标准**：已完成（本文）
- **实现核心改动并跑通测试门禁**：门禁自包含 + 硬断言；`npm test` 通过
- **灰度验证并记录结果**：见 `docs/canary-mvp-2026-08-05.md`（mock 层通过；未触 WP 生产/灰度）
