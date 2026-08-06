# WorkConnector 中继服务 · 系统设计

> 日期：2026-08-06 · 作者：OpenClaw（PM）
> 状态：**待评审**（评审通过后作为实现依据，与 `docs/workpet-connecter-design.md` D1–D12 对齐）
> 关联：`docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md`（cs 已实现 Phase 0–1）

## 0. 定位与设计原则

WorkConnector（下称 Connecter）是 WorkPet（本地桌宠）与 WorkPanel（云端群组平台）之间的**稳定中继层**：

- **不关心**生产/灰度等业务概念——路由由配置决定，自身单实例、单端口（:80）
- **只负责**统一通信能力：注册、认证、会话、路由、转发、可靠性
- **不承担**业务（群管理、Agent 执行、IM UI）——那是 WorkPanel / WorkPet 的事

设计原则：

| 原则 | 含义 |
|---|---|
| P1 无业务状态 | 中继只存「连接态」与「转发态」，不存业务语义 |
| P2 适配器化 | WorkPanel / 未来 WorkPad 等都是 backend adapter，新增后端不改核 |
| P3 契约先行 | 对外统一消息信封（envelope），内部实现可替换 |
| P4 默认安全 | 默认 canary、prod 显式开关、token 可吊销 |
| P5 可恢复 | 消息/run 落盘 + 幂等 + 重试，重启不丢关键状态 |

## 1. 整体架构

```text
┌─────────────┐   HTTPS / Agent Protocol    ┌──────────────────────────────┐
│  WorkPet    │ ──────────────────────────► │        WorkConnector         │
│  (用户桌面)  │ ◄────────────────────────── │  ┌────────────────────────┐  │
└─────────────┘   轮询回显(MVP) / WS(二期)   │  │ 接入层 auth/session    │  │
                                            │  ├────────────────────────┤  │
┌─────────────┐   A2A (REST + 群 @Agent)    │  │ 注册与映射 registry     │  │
│  WorkPanel  │ ◄─────────────────────────► │  ├────────────────────────┤  │
│  (云端,多实例)│                             │  │ 路由与消息总线           │  │
└─────────────┘                             │  ├────────────────────────┤  │
                                            │  │ 后端适配器 workpanel    │  │
                                            │  └────────────────────────┘  │
                                            └──────────────────────────────┘
```

分层与依赖方向：`接入层 → 注册/会话层 → 路由/消息层 → 适配器层`，上层只依赖下层的**接口**，不依赖实现。

关键拓扑决策（承 D5/D6/D8/D10）：

- Connecter **单实例、单端口 :80**；开发期 `CONNECTER_RELAY_PORT=9080`
- 后端注册在配置：`canary → 127.0.0.1:8081`、`prod → 127.0.0.1:8080`；请求带 `env` 或走默认
- MVP 消息主路径 `WorkPet → Connecter → WorkPanel`；回显走**轮询**（WorkPet 拉取），`WorkPanel → Connecter → WorkPet` 推送为二期（WS/回调），但**协议与数据模型现在就按双向设计**，避免二期返工

## 2. 核心模块划分

| 模块 | 文件（现状/建议） | 职责 |
|---|---|---|
| **接入层** | `src/relay/server.js`（已有） | HTTP 服务、路由挂载、限流、TLS 终止点（外层） |
| **认证与会话** | `src/relay/auth.js`（已有雏形） | 用户/Agent 身份认证、token 签发与吊销、session 生命周期 |
| **注册与映射** | `src/registry.js`（现有 CLI registry 演进） | Agent 注册（pet agent）、群组↔Agent 实例映射、实例状态 |
| **路由** | `src/relay/router.js`（已有） | env → backend 解析、请求分发、prod 开关拦截 |
| **消息总线** | 新增 `src/relay/messaging.js` | 统一信封封装、方向路由（上行/下行）、投递跟踪、幂等 |
| **run 状态** | `src/relay/runStore.js`（已有） | run 记录、受理回执、回读查询 |
| **后端适配器** | `src/workpanelClient.js`（已有） | WorkPanel 适配：login/health/群 metadata/发消息 @Agent/runs 回读；未来 `workpad` 等新适配器同接口 |
| **可靠性** | 新增 `src/relay/delivery.js` | 落盘、重试、死信、启动恢复 |
| **运维面** | `bin/connecter-relay.js` + CLI（已有） | 启动、health、日志、配置校验 |

模块边界规则：**接入层不直接碰 adapter**；消息一律经消息总线；注册/映射只被接入层与路由层读。

## 3. 通信协议设计

### 3.1 对外协议（WorkPet ↔ Connecter）— REST + JSON，MVP

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/v1/health` | 探活 | 无 |
| POST | `/v1/register` | Agent 注册（见 §3.3） | 用户 token |
| POST | `/v1/chat` | 上行：发消息 `{env, group, agent, content}` → 受理回执 | pet token |
| GET | `/v1/messages?since=<cursor>` | 下行回显：拉取本 Agent 实例的新消息（轮询） | pet token |
| GET | `/v1/runs/{id}` | 查 run 状态 | pet token |
| POST | `/v1/session/revoke` | 主动下线 | pet token |

二期（协议预留，不实现）：`WS /v1/ws` 长连接替代轮询；`POST /v1/callback` 供 WorkPanel 侧推送。

### 3.2 后端协议（Connecter ↔ WorkPanel）— 复用现有 A2A 路径

沿用 `workpanelClient` 已验证能力：login → health → 群 `team_metadata` → `POST /api/messages` @协调 Agent → 产生 runId。**不在 MVP 引入新 WP 侧协议**；WP 侧主动回调（登记/推送）二期再定。

### 3.3 统一消息信封（envelope）

所有经 Connecter 的消息（无论方向）统一结构：

```json
{
  "id": "msg_<uuid>",            // Connecter 生成，全局唯一
  "type": "chat.text",           // 类型，便于扩展（chat.audio/event.*）
  "direction": "up|down",        // up=Pet→WP，down=WP→Pet
  "conversation": "grp_<id>",    // 群组维度会话
  "from": {"kind": "pet|agent", "id": "..."},
  "to":   {"kind": "agent|pet", "id": "..."},
  "payload": {"content": "..."}, // 业务载荷，格式由 type 决定
  "ts": 1786000000000,
  "ack": "accepted|delivered|failed"
}
```

规则：`id` 幂等键（重复投递去重）；`ack` 由 Connecter 推进；`conversation` 决定路由目标群。

### 3.4 注册协议（MVP 简化 + 协议预留）

- **MVP：配置式注册**——`relay.json` 登记 `pets: [{id, token, groups: [{env, groupId, agentName}]}]`，启动即生效，无运行时注册 API 的审批复杂度
- **协议预留（二期）**：`POST /v1/register` 动态注册 → 管理员审批 → 绑定群；一条 WorkPet 可注册**多个 Agent 实例**（每群一个），对应 `agent_instances` 表

## 4. 数据结构设计

### 4.1 实体关系

```text
user (用户) 1─n pet (WorkPet 实例)
pet 1─n agent_instance (每绑定一个群 = 一个 pet agent 实例)
agent_instance n─1 group (群，含 env + groupId)
agent_instance 1─n session (登录会话)
agent_instance 1─n message (上行/下行)
message 1─0..1 run (WP 侧执行记录)
```

### 4.2 表设计（SQLite，`data/connector.db`）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, username, token_hash, created_at | 用户身份（MVP 可=配置） |
| `pets` | id, owner_user_id, name, status(online/offline), last_seen_at | WorkPet 实例 |
| `agent_instances` | id, pet_id, agent_type(default `pet`), env, group_id, group_name, agent_name, status(active/disabled) | **群↔Agent 映射**；一 pet 多行=多群多实例 |
| `sessions` | id, agent_instance_id, token_hash, status(active/revoked), expires_at, created_at | 会话；token 可吊销 |
| `messages` | id, direction, envelope_json, status(accepted/delivered/failed), retries, created_at | 统一信封落盘；幂等键 |
| `runs` | id, message_id, agent_instance_id, status(queued/running/completed/failed), created_at | 复用现有 runStore 语义落库 |
| `delivery_log` | id, message_id, target, attempt, result, ts | 重试审计 |

MVP 持久化策略：`messages` / `runs` / `agent_instances` / `sessions` **落盘**（重启不丢、可恢复）；`pets` 在线状态可内存（重启后按 last_seen 判定离线）。

## 5. MVP 实现方案

### 5.1 范围（对齐 D10/D11/D12，扩展注册与回显）

| 项 | MVP | 二期 |
|---|---|---|
| 链路 | WorkPet → Connecter(:80) → WP canary | WP → Connecter 推送/回调 |
| 注册 | 配置式（relay.json pets 段） | `/v1/register` 动态 + 审批 |
| 回显 | WorkPet 轮询 `GET /v1/messages` | WS 长连接 |
| 持久化 | messages/runs/registrations/sessions 落 SQLite | 分片/多实例 |
| 安全 | token 鉴权 + 默认 canary + prod 显式开关 | mTLS / 吊销 UI |
| 适配器 | workpanel（已有） | workpad 等 |

### 5.2 落地顺序（衔接 cs 已完成的 Phase 0–1）

| 阶段 | 内容 | 门禁 |
|---|---|---|
| Phase 0–1 ✅（cs 已完成） | 中继核：router/auth/handlers、`test:relay`、`RELAY_GATE_OK` | `npm test` / `test:relay` |
| **Phase 1.5（新增，本设计）** | 注册/映射落库（agent_instances/sessions/messages 表）+ `GET /v1/messages` 回显 + 幂等去重 | `test:relay` 扩展 |
| Phase 2 | systemd 占 :80（+可选 443→80） | 端口/健康检查 |
| Phase 3 | `apps/workpet` Tauri 猫猫球：调 `/v1/chat` + 轮询回显 | 桌面冒烟（手动） |
| Phase 4 | E1–E7 联调验收 + 灰度记录 | canary gate |
| Phase 5（二期） | WS、WP 回调、动态注册、多适配器 | — |

### 5.3 并发与可靠性要点

- **并发**：Node 单进程异步 IO 足够 MVP（每消息一个 WP 请求，天然并发）；SQLite 写串行化（WAL）；连接数限流（每 pet 每分钟 N 次）
- **可靠性**：上行消息先落盘（status=accepted）再转发；转发失败重试 ≤3 次（指数退避）→ 死信；WorkPet 轮询用 `since` 游标，断线重连后从游标续拉，**不丢不重**
- **恢复**：启动时扫描 `messages` 中 `accepted` 未 `delivered` 的记录续投；session 过期自动清理；agent_instance 状态变更写审计

### 5.4 验收清单（MVP 完成定义）

- [ ] `npm test`（mock 门禁）绿；`npm run test:relay` 绿（含回显与幂等用例）
- [ ] canary 联调：WorkPet 模拟端 → `/v1/chat` → 灰度群真实 run 受理；轮询拉到下行消息
- [ ] 注册映射：配置 2 个群 = 2 个 agent_instance，路由互不串
- [ ] 可靠性：模拟 WP 不可达 → 重试 → 死信；重启后未投递消息续投
- [ ] 安全：无 token 403；`prod` 从 WorkPet 侧 403（`allowProdFromPet=false`）
- [ ] docs 同步（本设计 + plan 更新）

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 中继单点 | health + systemd 自动重启；配置热更后置 |
| 消息丢失/重复 | 落盘 + 幂等键 + 游标续拉（§5.3） |
| 误打生产 | `allowProdFromPet=false` 硬默认 + 审计日志 |
| SQLite 写瓶颈 | WAL + 写串行化；多实例期换 PG（适配器隔离） |
| 与 cs 实现并行冲突 | 本设计为文档，Phase 1.5 起实现前先在群内确认 |
| token 泄露 | 可吊销 + 轮换；二期 mTLS |

## 7. 待确认（3 个开放问题）

1. **注册形态**：MVP 用配置式注册（推荐，零审批复杂度），还是就要运行时 `/v1/register` + 管理员审批？
2. **回显方式**：MVP 接受轮询回显（推荐，简单可靠），还是必须 WS 长连接（排期 +1~2 天）？
3. **持久化**：MVP 就落 SQLite（推荐，满足可靠性要求），还是内存态即可、二期再落盘？
