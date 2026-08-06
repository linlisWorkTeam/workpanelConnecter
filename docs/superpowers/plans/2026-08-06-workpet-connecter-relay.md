# WorkPet × Connecter 中继 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地稳定 Connecter HTTP 中继（`:80`）+ 同仓 WorkPet 猫猫球 MVP，使桌宠经中继调度到 WorkPanel canary，不直连 WP、不走 SSH。

**Architecture:** Connecter 增加常驻 `relay` HTTP 服务（单实例、无自产/灰槽）；内部复用现有 `workpanelClient` 按 `env` 路由到 WP `:8081`/`:8080`。WorkPet（Tauri）只调中继 `/v1/*`。CLI 保留运维面。WP→Connecter 回连二期。

**Tech Stack:** Node ≥18（零或极少依赖）中继；现有 `src/workpanelClient.js`；WorkPet = Tauri 2 + 简单前端（HTML/TS）；systemd 部署；门禁 `npm test` + `npm run test:canary` + 新 `npm run test:relay`。

**Spec:** `docs/workpet-connecter-design.md`（D1–D12）· `docs/superpowers/specs/2026-08-05-workpet-connecter-design.md`

## Global Constraints

- 群公告：本项目解决**多 WorkPanel 间交互**；Connecter **只做中继/调度，不做业务**。
- Connecter **占 :80**；自身**无**产/灰双槽；路由表区分 WP backends。
- MVP：**WorkPet → Connecter → WP** only；默认 **env=canary**；禁止桌宠默认打 prod。
- TLS：MVP **HTTP :80**；公网前外层 **443→80**（不在本期实现 T2 除非单列任务）。
- **不碰** LinlisWorkPanel 生产发版/promote；联调只用 canary `:8081`。
- 不新建 AT2AT；不把猫猫球 UI 塞进 Connecter CLI 核。
- 现有 mock 门禁 `npm test` 不得无故破坏。

---

## 目标目录结构（落地后）

```text
/AI/WorkPanelConnecter/
  config/
    relay.example.json          # listen:80 + backends canary/prod + token
    servers.canary.json         # 已有（CLI/直连测）
  src/
    workpanelClient.js          # 已有，中继复用
    coordinator.js              # 已有
    relay/
      server.js                 # HTTP :80 入口
      auth.js                   # Bearer token
      router.js                 # env → backend
      handlers.js               # /v1/health|envs|chat|runs|logs
      runStore.js               # 受理记录 + 可选 WP run 查询缓存
  bin/
    connecter.js                # 已有 CLI
    connecter-relay.js          # 新：启动中继
  apps/workpet/                 # Tauri 桌宠
    src-tauri/
    ui/                         # 悬浮球 + 聊天面板
  scripts/
    smoke.js                    # 已有 mock 门禁
    canary-gate.js              # 已有
    relay-gate.js               # 新：打本机中继→canary
  docs/...
  package.json                  # scripts: relay, test:relay
```

---

## Phase 0 — 文档与配置骨架

### Task 0.1: 中继配置样例与边界说明

**Files:**
- Create: `config/relay.example.json`
- Modify: `docs/scheduling-boundaries.md`（补充：中继 :80、WorkPet 同仓、默认 canary）
- Modify: `README.md`（中继启动说明占位）

**Steps:**
- [ ] 写入 `relay.example.json`：`listen.port=80`、`backends.canary/prod`、`auth.tokens[]`、`defaults`、`allowProdFromPet=false`
- [ ] 边界文档增加「Connecter=中继+CLI；GUI 仅 WorkPet」
- [ ] `git add` 相关文件并 commit（若用户要求提交时）

**Verify:** 配置 JSON 可被 `JSON.parse`；文档无「Connecter 纯 CLI、永不 HTTP」旧表述冲突。

---

## Phase 1 — Connecter HTTP 中继核

### Task 1.1: 路由与鉴权纯函数

**Files:**
- Create: `src/relay/router.js`
- Create: `src/relay/auth.js`
- Create: `scripts/relay-unit-smoke.js`（或 `tests/relay-router.test.js` 用 node assert）

**Steps:**
- [ ] `resolveBackend(config, env)`：缺省 defaults.env；未知 env → 错；`prod` + `allowProdFromPet=false` 且 client=pet → 拒绝
- [ ] `checkBearer(req, config)`：比对 `Authorization: Bearer`
- [ ] 写最小断言脚本并跑通

**Verify:** `node scripts/relay-unit-smoke.js` exit 0

### Task 1.2: handlers + runStore

**Files:**
- Create: `src/relay/runStore.js`
- Create: `src/relay/handlers.js`
- Modify: 复用 `src/workpanelClient.js`（必要时导出小幅整理，避免破坏 CLI）

**Interfaces:**
- `POST /v1/chat` body: `{ env?, group?, agent?, prompt }` → `{ messageId, runIds, status: "accepted", env }`
- `GET /v1/health` → `{ ok: true, service: "connecter-relay" }`
- `GET /v1/envs` → 后端名列表（无密码）
- `GET /v1/runs/:id` → 摘要（MVP：先查本地 store；能调 WP 则补 run 状态）
- `GET /v1/logs?limit=` → 中继侧 JSONL/内存环形缓冲

**Steps:**
- [ ] chat：resolve backend → 构造伪 server/team → `dispatchWorkPanel` → 写入 store + logs
- [ ] runs：按 runId/messageId 查 store；可选再请求 WP（若 API 允许）
- [ ] 单元：mock `dispatchWorkPanel` 或对 canary 手工测（Task 1.4 门禁）

**Verify:** handler 在 node 内可直接调用返回 accepted 形状

### Task 1.3: HTTP server 入口（:80）

**Files:**
- Create: `src/relay/server.js`
- Create: `bin/connecter-relay.js`
- Modify: `package.json`（`"relay": "node bin/connecter-relay.js"`）

**Steps:**
- [ ] 原生 `http.createServer`；解析 path/method；鉴权中间层
- [ ] 环境变量：`CONNECTER_RELAY_CONFIG`、`CONNECTER_RELAY_PORT`（默认取配置 80；开发可用 `PORT=9080` 免 root）
- [ ] 开发约定：文档写明 `CONNECTER_RELAY_PORT=9080` 本地测；生产 systemd 绑 80
- [ ] 启动日志打印 listen 地址与 backends 名

**Verify:** `CONNECTER_RELAY_PORT=9080 npm run relay` 后 `curl :9080/v1/health` → 200

### Task 1.4: 中继门禁 `test:relay`

**Files:**
- Create: `scripts/relay-gate.js`
- Modify: `package.json`（`test:relay`）
- Modify: `docs/mvp-status-and-acceptance.md` 或新 `docs/relay-acceptance.md`

**Steps:**
- [ ] 脚本自启 relay@9080（或复用已起进程）
- [ ] 无 token → 401
- [ ] 有 token → health/envs/chat(canary) → accepted
- [ ] env=prod 且 allowProdFromPet=false → 4xx
- [ ] 不可达 backend → failed 语义
- [ ] 断言结束杀进程

**Verify:** 在 canary WP `:8081` 可用时 `npm run test:relay` → `RELAY_GATE_OK`（可标 skip 若 8081 挂）

---

## Phase 1.5 — 注册/会话/消息落库 + 回显 + 幂等（2026-08-06 新增，规范见 `docs/workconnector-system-design.md`）

> 依据：root 确认 **1A 配置式注册 / 2A 轮询回显 / 3A SQLite 落盘**（2026-08-06 11:22，已写入系统设计规范）。

### Task 1.5.1: 数据层（SQLite，WAL）

**Files:**
- Create: `src/relay/db.js`（SQLite 打开/WAL/建表/迁移）
- Create: `src/relay/schema.sql`（表：`users` / `pets` / `agent_instances` / `sessions` / `messages` / `runs` / `delivery_log`）
- Modify: `config/relay.example.json`（加 `db: { path: "data/connector.db" }` + `pets: []` 配置式注册段）

**Steps:**
- [ ] 表结构与系统设计 §4.2 一致；`messages.id` 唯一 = 幂等键
- [ ] `agent_instances`：一 pet 多行（每绑定群一个实例），含 env/group/agent_name/status
- [ ] WAL 开启；写串行化（单连接或队列）

**Verify:** 启动建表成功；重复插入同 `messages.id` 被拒

### Task 1.5.2: 配置式注册 + 会话

**Files:**
- Modify: `src/relay/router.js` / `src/relay/auth.js`（读 `pets` 配置 → 落 `agent_instances`；token 校验改查 `sessions`/配置）

**Steps:**
- [ ] 启动时读 `relay.json.pets`，为每个 `{petId, token, groups:[{env, groupId, agentName}]}` 建立 agent_instance（幂等 upsert）
- [ ] pet token 鉴权（配置 token 或 session token）；`/v1/session/revoke` 置失效
- [ ] 每 pet 限流（默认 60 req/min）

**Verify:** 配 2 个群 → 2 个 agent_instance；错 token 401；revoke 后 401

### Task 1.5.3: 消息落盘 + 回显 + 幂等

**Files:**
- Create: `src/relay/messaging.js`（信封封装、方向路由、落盘）
- Create: `src/relay/delivery.js`（重试 ≤3 指数退避 → 死信；启动续投）
- Modify: `src/relay/handlers.js`（`/v1/chat` 先落盘再转发；新增 `GET /v1/messages?since=`）

**Steps:**
- [ ] 上行：envelope 落盘(status=accepted) → 调 workpanel 发消息 → 记录 run → status=delivered/failed
- [ ] 下行回显：`GET /v1/messages?since=<cursor>` 返回该 agent_instance 的新消息（游标=自增 id）
- [ ] 失败重试 ≤3 次 → `delivery_log` 死信；启动扫描 accepted 未 delivered 续投
- [ ] 重复投递：同 `messages.id` 直接返回已有受理结果（幂等）

**Verify:** 扩展 `test:relay`：chat→accepted→轮询拉到消息；WP 不可达→重试→死信；重启续投；重复 chat 同 id 不双发

### Task 1.5.4: 门禁与文档

**Steps:**
- [ ] `npm run test:relay` 含 1.5.3 用例 → `RELAY_GATE_OK`
- [ ] `docs/workconnector-system-design.md` §5.4 验收清单逐项过
- [ ] README 增补「配置式注册 + 轮询回显」示例

**Verify:** 全门禁绿；canary 联调一次（模拟 pet → /v1/chat → 灰度群真实 run → 轮询回显）

---

## Phase 2 — 部署（服务器中继）✅ 已完成（2026-08-06，方案 B）

> 落地：root 拍板 **B**（nginx :80 反代 `/v1/*` → Connecter :9080），见 D16。
> systemd 服务 `connecter-relay` 已 enable+active；nginx 已加 `/v1/` location（备份 `workpanel.conf.bak.202608061200`）。
> 验证：`:9080/v1/health` ✅、`:80/v1/health` ✅、homepage :80/ 仍 200 ✅、经 :80 真实 chat → canary runId `59b74233-…` ✅

### Task 2.1: systemd unit + 端口策略

**Files:**
- Create: `deploy/connecter-relay.service`
- Create: `deploy/README.md`（占 80、冲突检查、`setcap`/`AmbientCapabilities=CAP_NET_BIND_SERVICE`）
- Create: `config/relay.json`（gitignore，从 example 拷）—— **勿提交真实 token**

**Steps:**
- [ ] unit：`ExecStart=/usr/bin/node .../bin/connecter-relay.js`；`Restart=on-failure`
- [ ] 检查 `ss -lntp | grep ':80'`；文档写清迁走冲突服务
- [ ] 验证 canary 仍 `:8081`、prod `:8080` 不被本 unit 改写

**Verify:** `systemctl start` 后本机 `curl http://127.0.0.1/v1/health`（需 token 策略允许 health 可匿名——**建议 health 匿名、其余要 token**）

### Task 2.2:（可选后置）T2 外层 443

**Files:**
- Create: `deploy/caddy.example` 或 nginx snippet：`443 → 127.0.0.1:80`

**Steps:**
- [ ] 仅文档 + 样例；不强制本期上线

**Verify:** 样例配置语法正确即可

---

## Phase 3 — WorkPet（猫猫球）MVP ✅ 已完成（2026-08-06，OpenClaw）

> 落地：`apps/workpet/`（Tauri 2 壳 + 纯 JS SDK）；SDK 契约门禁 `test:workpet` 对线上 :80 全绿（`WORKPET_GATE_OK`）。
> 说明：Tauri 壳需在桌面系统（Win/macOS）构建（服务器无 GUI 库、Tauri 不支持跨平台出包）；构建步骤见 `apps/workpet/README.md`。
> CORS：nginx `/v1/` 已放开跨源（MVP），T2 收紧为源白名单。


### Task 3.1: Tauri 工程骨架

**Files:**
- Create: `apps/workpet/`（`package.json`、`src-tauri/`、`ui/index.html`）
- Modify: 根 `README.md` 链到 WorkPet 构建说明

**Steps:**
- [ ] `npm create tauri-app` 或手写最小 Tauri 2 窗口：无边框、置顶、透明、小尺寸
- [ ] 开发期可用「普通小窗」降低透明窗平台差异

**Verify:** `cd apps/workpet && npm run tauri dev` 能起窗（在有 GUI 的开发机）

### Task 3.2: 中继客户端 SDK（共享）

**Files:**
- Create: `packages/connecter-client/` 或 `apps/workpet/src/connecterApi.ts`（MVP 可先放 pet 内，避免过早 monorepo 复杂化）
  - **建议 MVP：** `apps/workpet/ui/connecterApi.js`
  - **二期：** 抽 `packages/connecter-client` 给 WP 回连用

**Steps:**
- [ ] `health` / `chat` / `getRun`；baseUrl + bearer 来自本地配置
- [ ] 默认 `env=canary`；UI 不提供 prod（除非高级设置）

**Verify:** 对 `http://<server>:80`（或开发 9080）curl 级等价调用成功

### Task 3.3: 猫猫球 UI

**Files:**
- Create: `apps/workpet/ui/` — 球态组件、展开聊天、状态映射 idle/thinking/error
- Create: `apps/workpet/ui/skins/default/` — 静态 PNG/SVG（可先单图）

**Steps:**
- [ ] 点击球 → 展开输入框 + 消息列表
- [ ] 发送 → `POST /v1/chat` → 气泡显示 accepted + runId
- [ ] 轮询 `GET /v1/runs/:id`（2s，最多 N 次）更新状态文案
- [ ] 失败态变色/提示

**Verify:** 人工：对 canary 发一条「ping」，见 messageId；球 thinking→idle

### Task 3.4: 桌面配置

**Files:**
- Create: `apps/workpet/config.example.json`（connecterBaseUrl、token、group、agent）
- Document: 用户目录配置路径（如 `~/.workpet/config.json`）

**Steps:**
- [ ] 首次启动读配置；缺失则提示复制 example
- [ ] **禁止** example 默认指向 prod

**Verify:** 错误配置时有明确报错，不静默打到 8080

---

## Phase 4 — 联调与验收 ✅ 已完成（2026-08-06，OpenClaw 服务器侧）

> E1–E8 全部通过，证据见 `docs/workpet-e2e-checklist.md` 与 `docs/canary-workpet-relay-2026-08-06.md`。
> 补充：`scripts/e2e-resume-test.js`（杀进程重启续投，`RESUME_E2E_OK`）；relay-gate 端口 9080→9095（避免与生产 systemd 撞端口）。


### Task 4.1: E2E 清单（人工 + 脚本）

**Files:**
- Create: `docs/workpet-e2e-checklist.md`
- Modify: `docs/ROADMAP.md`（挂 WorkPet / 中继阶段）

**验收标准（全部勾上才算 MVP 完成）：**

| # | 项 |
|---|----|
| E1 | `npm test`（mock）仍绿 |
| E2 | `npm run test:canary` 在 8081 可用时绿（直连适配回归） |
| E3 | `npm run test:relay` → `RELAY_GATE_OK` |
| E4 | 中继生产形态可听 80（或 cap 绑 80）；health 通 |
| E5 | WorkPet 经中继发到「灰度测试」@固定 Agent，有 messageId/runId |
| E6 | 无 token 被拒；prod 默认拒 |
| E7 | Connecter 无业务网页；无 SSH 依赖 |

### Task 4.2: 灰度验证记录

**Files:**
- Create: `docs/canary-workpet-relay-YYYY-MM-DD.md`（实测时间、messageId、未碰 :8080 promote）

---

## Phase 5 — 明确二期（本期不实现，仅列清单）

| 项 | 说明 |
|----|------|
| P5.1 | WorkPanel → Connecter 登记/心跳/跨实例转发 |
| P5.2 | 外层 HTTPS 443→80（T2）正式部署 |
| P5.3 | 流式回复 / WS 推送到 WorkPet |
| P5.4 | 完整 F229 级走动/语音 |
| P5.5 | 独立非 AI「协调 Agent」替换群 admin Agent 门面 |
| P5.6 | `packages/connecter-client` 抽公共包 |
| P5.7 | `/restart-server` `/obs` |
| P5.8 | Connecter 热更新路由、多 token 吊销 UI |

---

## 实现顺序总览（一张表）

| 序 | 任务 | 产出 | 门禁 |
|----|------|------|------|
| 0.1 | 配置+文档 | `relay.example.json` | parse OK |
| 1.1 | router/auth | 纯函数 | unit smoke |
| 1.2 | handlers/store | `/v1/chat` 等 | 形状断言 |
| 1.3 | server :80/9080 | `npm run relay` | curl health |
| 1.4 | relay-gate | `test:relay` | RELAY_GATE_OK |
| 2.1 | systemd | 服务常驻 | curl :80 |
| 2.2 | T2 样例 | 可选 | 文档 |
| 3.1 | Tauri 骨架 | 窗口 | tauri dev |
| 3.2 | API 客户端 | chat/run | 联调 |
| 3.3 | 猫猫球 UI | 收发 | 人工 |
| 3.4 | 桌面配置 | 安全默认 | 负向测 |
| 4.1–4.2 | E2E 记录 | checklist + 灰度笔记 | E1–E7 |

**建议工期切分：** Phase1（中继）可纯服务器完成 → Phase3（WorkPet）需桌面 GUI 环境 → Phase2 可与 3 并行。

---

## 风险（执行时盯住）

| 风险 | 缓解 |
|------|------|
| :80 被占 / 无权限 | 开发用 9080；生产 setcap 或迁冲突服务 |
| 误伤 prod | `allowProdFromPet=false`；Pet UI 无 prod |
| 触发真实 Agent 费用/噪音 | 门禁文案固定「ping / 勿深层委派」 |
| Tauri 在无 GUI CI 无法编 | CI 只跑 relay-gate；pet 人工/桌面机编 |
| 异步 run 回显弱 | MVP 只保证 accepted；完整回复二期 |

---

## 开工指令（给人 / Agent）

1. 读本 plan + `docs/workpet-connecter-design.md`  
2. 从 **Task 0.1 → 1.4** 做完再开 WorkPet  
3. 每 Task 结束跑对应 Verify；用户要求时再 commit  
4. **禁止** promote WP 生产、禁止改 prod data 目录  
