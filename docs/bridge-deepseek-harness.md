# WorkPanelConnecter × DeepSeek Harness — 桥接定位与设计

> 状态：**定位稿（2026-08 更新）· 关键决策已锁定（root 拍板）· 对接协议细节仍为草案**
> 关联：`docs/workconnector-system-design.md`（N1–N3 规范）· `docs/workpet-connecter-design.md`（D1–D22）· `docs/CONNECTER-EVOLUTION.md`（E1–E4 演进）· `docs/api-relay.md`（冻结契约）

## 1. 一句话定位

**WorkPanelConnecter（下称 Connecter）是「各 WorkPanel（云端群组平台）」与「DeepSeek Harness（dsh，本机/远端 Agent 执行框架）」之间的稳定桥上中继与调度平面**；WorkPet 是桌面入口（UI）。Connecter 只做调度/中继/路由，不执行业务、不内嵌 Agent。

```text
┌─────────────┐   /v1/*  HTTPS    ┌──────────────────────────────┐   A2A / WP API    ┌─────────────────┐
│  WorkPet    │ ─────────────────► │          Connecter           │ ◄───────────────► │   WorkPanel     │
│  (桌面 UI)   │ ◄───────────────── │  注册表 · 路由 · 信封 · 可靠投递 │                  │  (canary/prod)  │
└─────────────┘   since 轮询回显    └──────┬───────────────────────┘                  └─────────────────┘
                                          │  agent / endpoint 路由
                                          ▼
                              ┌──────────────────────────────┐
                              │   DeepSeek Harness (dsh)      │
                              │   headless / JSON-RPC / ACP   │
                              │   本机或远端 码代 Agent 执行    │
                              └──────────────────────────────┘
```

**关键边界**：Connecter **不**把 Agent 进程搬进自己；它在 **Team↔Team** 场景走 WorkPanel 群门面（现有），在 **Team 内跨机执行** 场景把任务按 `agent_instance → endpoint` 转发到 DeepSeek Harness Runner，执行发生在各自机器。

### 1.1 已锁定决策（root 拍板，2026-08）

| # | 决策 |
|---|------|
| B1 | **身份形态 = A**：dsh 作为 WP 群里的**独立 Agent 身份**（如 `@DeepSeek`），经 Connecter **直达**调度，不让群协调门面中转执行 |
| B2 | **dsh 是一种 agent 类型，可多实例部署**（不同服务器）；它们是同一类型的多个 runtime |
| B3 | **两种接入（workpanel 群 ≠ 普通群聊）**：①「WorkPanel 自身维护群」只能接入**特殊唯一 dsh**（全局唯一、root 指定一次，作为 WorkPanel 自举/自身维护手段）；② WorkPanel 上普通**群聊**可接入**通用 dsh**（每个群聊一个、可多实例、非唯一） |
| B4 | **本地 dsh = 常驻 Runner，只出站**：不开放入站口，由 **Connecter 拉任务**（出站 poll/长连接）；NAT 友好，正式链路不走 SSH 隧道 |
| B5 | **执行/会话分工**：会话 source-of-truth 留在 WP 群线程；dsh 只管执行；Connecter 负责注册路由、协议翻译与回写 WP 群 |
| B6 | **Runner 执行协议 = ACP**（Agent Client Protocol）：dsh 端执行统一走 ACP；出站通道承载 ACP 消息 |
| B7 | **动态注册 API = `/v1/agents/*` 草案**（cs 定稿，见 §4.4）：dsh 出站 register/heartbeat/tasks/result |


**概念澄清（root 拍板）**：**WorkPanel 群 ≠ WorkPanel 上的群聊**。
- **WorkPanel 群** = 维护 WorkPanel 自身的群（内部/自举群）。
- **WorkPanel 上的群聊** = 跑在 WorkPanel 上的普通用户群聊。
- 自举语义：**WorkPanel 群** 只能接入**特殊唯一 dsh**（root 指定一次），作为维护 WP 自身的 Agent；普通**群聊** 各自接入**通用 dsh**（可多实例、非唯一）。

## 2. 角色与职责

| 角色 | 位置 | 性质 | 职责 |
|------|------|------|------|
| **Connecter** | 服务器（中继 :80 / 9080 + CLI） | 非 AI | 注册表、路由（env / group / agent_instance → endpoint）、统一消息信封、鉴权、可靠投递（落盘+幂等+重试/死信）、调度日志 |
| **WorkPanel** | 云端（canary :8081 / prod :8080） | AI / 群平台 | 群与会话权威、协调/值班 Agent 门面、团内工作 Agent；Connecter 不旁路其工作 Agent |
| **DeepSeek Harness (dsh)** | 本机 / 远端（可多实例） | AI 执行 | 一种 agent 类型，可多实例部署；分**特殊唯一 dsh**（仅接 WorkPanel 自身群，自举）与**通用 dsh**（可接普通群聊）；接收 Connecter 沿 **ACP** 拉派的任务并真正执行 |
| **WorkPet** | 用户桌面 | UI | Live2D 桌宠 + 聊天；只调 Connecter `/v1/*`，不直连 WP / dsh |

## 3. DeepSeek Harness 侧的可用接口（据官方仓库，非臆造）

dsh 是 DeepSeek 开源 agent harness（`@deepseek-ai/dsh`，Web 默认 `http://127.0.0.1:3080`）。对 Connecter 这类“程序化客户端”，可对接的接口包括：

| 接口 | 入口 | 特点 | 适合的桥接形态 |
|------|------|------|----------------|
| **headless** | `dsh --profile headless "<task>"` | 一次性任务 → 打印最终文本 → 退出 | 同步任务（Connecter 拉/推一次） |
| **jsonrpc-agent** | Python SDK + JSON-RPC 运行时 | 无人值守编码 agent；环境变量 `DSH_CWD/DSH_SESSION_ROOT/DSH_SYSTEM_PROMPT/DEEPSEEK_API_KEY…`，工具 bash/read/write/edit/subagent/todo_write | Connecter 以 JSON-RPC 客户端驱动（会话型异步） |
| **acp-agent** ⭐ 已选 | ACP (Agent Client Protocol) over JSON-RPC stdio | 自动化协议；`session/new`、取消、`session/request_permission` 等 | **Runner 执行协议 = ACP**（经 Connecter 出站通道承载） |
| **API Gateway** | HTTP `POST /api/<namespace>/<method>` | Typert Remote 一元方法（`@Remote` / `@RemoteScope`） | 若自定义 Runner 服务，可走该网关暴露任务端点 |
| **Web UI** | `:3080` | 人类界面 | 不作为集成接口 |

> 具体契约以 deepseek-harness 仓库（`D:\AI\deepseek-harness`）官方文档为准：`docs/architecture.zh.md`、`examples/{headless-agent,jsonrpc-agent,acp-agent}/README.md`、`docs/api-gateway.zh.md`。本仓库只描述“如何把它挂成 Connecter 的一个 runner 后端”。

## 4. Connecter 侧的桥接形态（对照现有规范）

### 4.1 现状（MVP Phase 0–4，已落地）
- `WorkPet → Connecter(/v1/*) → WorkPanel canary` 主链路 ✅
- 配置式注册（N1）、轮询回显（N2）、SQLite 落盘（N3）✅
- 默认 canary、禁默认 prod、token 鉴权、幂等/重试/死信 ✅

### 4.2 设计：DeepSeek Harness 作为群内唯一 Runner（E1/E2 · 已定）
- **注册**：dsh Runner 经 `POST /v1/agents/register` **出站**登记为 `agent_instance`（复用/扩展 `agent_instances`：加 `agent_type=dsh`、`role=special|general`、`channel_id`、`last_seen` 心跳 + TTL 下线）；与 N1 配置式并存，先静态后动态。
- **路由**：目标解析到 `agent_instance → endpoint`；调度策略：本机 Runner 优先 → 同群已注册远端 → 回落云端 WP 门面。
- **转发**：Connecter 按 Runner 的对外接口（§3）把任务信封投递；Runner 回调或 Connecter 轮询 Runner 状态 → 补全文回显（原 P2.3）。
- **特殊 vs 通用**：**WorkPanel 自身群** 只能接入**特殊唯一 dsh**（root 指定一次，自举/维护 WP）；**普通群聊** 各自接入**通用 dsh**（可重复，每个群聊一个 `@DeepSeek`）。
- **常驻 Runner / 出站拉任务**：本地 dsh 作为常驻 Runner，**不开放入站口**，由 **Connecter 沿出站通道拉任务**（poll / 长连接）；结果沿同通道回传（NAT 友好；正式链路不走 SSH 隧道）。
- **并发与串行**：同一 `agentId` 任务在 Connecter 侧逻辑串行（防双执行），物理分散。
- **云 WP 减负**：WP 并发 session 配置硬顶（如 2），溢出经 Connecter 改派到已注册的 dsh Runner（E1 验收：云内存不随任务数线性涨）。

### 4.3 链路走通的最小闭环（已定形态 A）
1. 常驻 dsh Runner 启动 → **只出站**向 Connecter 登记并维持“取任务”连接（poll / 长连接）→ 心跳应期上报（先可静态配置 `relay.json`，后过渡动态注册）。
2. 用户在 WorkPet 发消息 → `POST /v1/chat` → Connecter 落盘 accepted → 按 group/agent 解析到 dsh Runner endpoint。
3. Connecter 沿出站通道把 **ACP** 消息发给该群绑定的 dsh（special 或 general）执行任务。
4. Runner 完成 → 回调/被轮询 → Connecter 把 down 消息写入 `/v1/messages` → WorkPet 轮询回显。

### 4.4 E1 动态注册与出站通道（已定稿 · 代码已落地 `src/relay/runners.js` + `/v1/agents/*`）

新增 `/v1/agents/*` 一组端点（独立于 pet 的 `/v1/*` 冻结契约；Runner 用各自 token）：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/v1/agents/register` | dsh **出站注册**：`{ agentId, agentType:"dsh", role:"special\|general", groups:[{env, groupId\|groupName, agentName:"DeepSeek"}], token }` → 200 返回 `{ agentId, channelId, taskUrl, heartbeatUrl }`；幂等 upsert `runners`/`runner_bindings`（独立于 pet 的 `agent_instances`，避免 FK/`pet_id` 改造），special 施加“仅 WorkPanel 自身群 + 唯一”约束 |
| POST | `/v1/agents/heartbeat` | 心跳续命（TTL 默认 60s）→ 200；超时判离线 |
| POST | `/v1/agents/tasks` | dsh **出站拉任务**：`{ channelId }` → 有 Pending 返回 ACP 信封（taskId/prompt/context），无则空 |
| POST | `/v1/agents/tasks/result` | dsh 回结果：`{ channelId, taskId, status:"completed\|failed\|cancelled", content }` → Connecter 以该 agent 身份回写 WP 群线程并落 run 终态 |
| GET  | `/v1/agents?group=&env=` | 运维查询注册表（辅助 special 唯一性校验） |

> **传输**：MVP 用 **dsh 主动轮询**（NAT 友好、实现简单）；**ACP 是 dsh 端执行协议**，消息经上述出站接口包装转发。WS/长连接承载 ACP 留作后续优化。

## 5. 已落地 vs 下一步

| 项 | 状态 |
|----|------|
| 中继核 / /v1/* / SQLite / 幂等 / canary 链路 | ✅ 已落地（Phase 0–4） |
| WorkPanel 群门面桥接（Team↔Team） | ✅ 已落地（过渡用群 admin Agent） |
| **deepseek-harness 注册进 Connecter 并作为执行 Runner** | 🟡 **E1 代码骨架已落地**（`/v1/agents/*` + `runners/runner_bindings/runner_tasks` 表 + ACP 承载通道 + pet-chat 改走 runner + 门禁 `npm run test:runner` / `scripts/relay-runner-smoke.js`）；⏳ 待真实 dsh 联调 |
| Runner → Connecter 回调 / 全文回显 | 🟡 **E2 部分落地**：结果落 run 终态 + pet 轮询 down echo + **best-effort 以 agent 身份回写 WP 群线程**（`workpanelClient.postAsAgent`）；⏳ 真实 WP 联调确认 |
| 中继高可用 / 注册表共识 | ⏳ E4（可选） |

## 6. 剩余待定（大方向已定，仅细节）

1. **鉴权细节**：Runner token 签发/轮换、群维度 ACL；公网前先完成 P1（443 / CORS 收紧）。
2. **任务语义**：Connecter 只转发生成任务（production smoke 固定文案），不解析业务语义——沿用现有“不透传业务”边界。
3. **出站传输取舍**：MVP 用 dsh 主动轮询拉任务；后续是否升级为 WS/长连接承载 ACP（B4 仍保证只出站、NAT 友好）。
4. **heartbeat TTL / special 唯一性校验**：TTL 默认 60s 的确认；special dsh 仅接 WorkPanel 自身群的落库唯一索引与权限位。
5. **dsh 侧 acp-bridge**：把 dsh 的 ACP（stdio JSON-RPC）桥接到 `/v1/agents/tasks` 出站通道的包装进程（放哪个仓库、谁维护）。

## 7. 硬约束（沿用，勿回退）

- 默认 **canary**；禁止默认打 prod；禁止 WP promote / 改写 WP 生产槽。
- Connecter **只做中继/调度**，不内嵌 dsh Agent、不把 OOM 挪到中继机。
- 不新建 AT2AT；跨团队统一 A2A/群门面。
- 不直连/旁路 WorkPanel 工作 Agent；不把业务 IM/群管理做进 Connecter。
- 公网/家宽 Runner 入网前必须先完成 HTTPS（T2）等安全基线。
