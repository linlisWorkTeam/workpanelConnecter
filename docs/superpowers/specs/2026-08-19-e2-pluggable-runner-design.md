# E2 可插拔 Runner — 设计稿

> 日期：2026-08-19 · Owner：**cs**  
> 状态：**待群内确认后实现**（本文只设计，不含代码）  
> 相关：`docs/CONNECTER-EVOLUTION.md` · `docs/api-relay.md` · `docs/bridge-deepseek-harness.md` · `src/relay/runners.js`

## 1. 已锁定决策（群内 2026-08-19）

| # | 决策 |
|---|------|
| R1 | Connecter 提供 **可插拔 Runner 槽**，不绑定 DeepSeek / dsh |
| R2 | 任何执行端只要走 `/v1/agents/*` 出站协议即可顶替（WP 实调用适配器、其它 Agent、以后的 dsh） |
| R3 | **完整 ACP 不在 Connecter 实现**；ACP 是 Runner 内部执行协议，E4 再由 dsh（或其它 Harness）对接同一 pull API |
| R4 | 本期 **不做 dsh**；E4 达线后再让 dsh 接手自举 |
| R5 | E2 **验收必须实调用** canary WP；两段下行：先 wpMessageId，再 poll 到的 Agent 全文。**禁止** echo mock 充当验收 |
| R6 | 冻结现有路径：`register` / `heartbeat` / `tasks` / `tasks/result` / `GET /v1/agents` |
| R7 | WP 群线程回写保持 **best-effort**；**GET `/v1/messages` 必须能看到全文/失败** |
| R8 | 不改 nginx、防火墙、8080/8081/9080 监听；不把 Agent 进程搬进 Connecter |

## 2. 问题

E1 已落地队列与出站 pull，但实现把 `agent_type` 写死为 `dsh`，下行对 Pet 仍偏 ack。E2 要在 **不引入 dsh** 的前提下做成通用执行总线，并用 **真实 WP 调用** 验收（不是本仓 echo mock）。

## 3. 方案选择

| 方案 | 做法 | 取舍 |
|------|------|------|
| A. 继续 dsh 类型 + mock 假扮 dsh | 改动最小 | 误导「只能 DeepSeek」；验收假 | **否** |
| **B. 通用 Runner 槽 + 第一插件=WP 实调用** | 类型可配；第一种实现把任务真正打到 canary WP Agent | 依赖 `:8081` 在线；不绑死 dsh | **采用** |
| C. Connecter 内嵌执行 | 中继自己跑模型 | 违反群公告 | **否** |

采用 **B**。special/general、每群一个 general 绑定、只出站 pull，全部保留。CI 单元测试可继续用内存桩，**不得**当作 E2 验收。

## 4. 拓扑（E2）

```text
WorkPet / 其它入口
    POST /v1/chat
            ▼
     Connecter 中继
     · 绑定命中 → runner_tasks 队列（同 agent 串行）
     · 未绑定   → 现有 WP 投递（云端兜底）
            ▼
     Runner（可插拔；本期第一插件 = WP 实调用适配器）
     出站：heartbeat + POST /v1/agents/tasks
     真正调用 canary WorkPanel Agent
     回：  POST /v1/agents/tasks/result
            ▼
     GET /v1/messages 可见全文
     （可选）best-effort 回写 WP 群线程
```

Connecter **不**实现 `session/new` / permission / stdio。task 信封保持可映射到未来 ACP（`taskId`、`prompt`、`context`），但不升级为 ACP 状态机。

## 5. 协议（冻结，仅澄清语义）

现有 API 不改路径。语义调整：

- `runners.agent_type`：默认 `'runner'`（或配置值）；旧值 `'dsh'` **仍合法**，视为一种 type。
- `agent_name`：绑定显示名，不默认 `'DeepSeek'`（配置缺省用 `'Runner'`）。
- register body 可带 `agentType`；未带则用预配或 `'runner'`。
- `POST /v1/agents/tasks`：同一 `(runnerId)` **最多 1 条 in-flight**（`dispatched` 未终态则不再派下一条 queued）。
- 心跳 TTL（默认 60s）过期 → `status=offline`，**新 chat 不再入队**（回落到 WP 或 503，见 §6）。
- `tasks/result`：写 `runner_tasks.result_json` + **down `messages` 正文**（必做）+ `postAsAgent` WP（失败只记 log）。

## 6. 路由与失败

| 条件 | 行为 |
|------|------|
| 有 active 绑定且 runner 心跳新鲜 | 入队，不打云 session |
| 有绑定但 runner offline | **不入队**；返回可机器识别错误（建议 503 `runner_offline`），避免静默打满云 WP |
| 无绑定 | 维持现状：WP `deliverWithRetry` |

## 7. 第一插件：WP 实调用适配器（验收用）

不写 `scripts/mock-runner.js` echo。第一种 Runner 实现把队列里的任务 **真实打到 canary WP**：

- 进程：`scripts/wp-runner.js`（出站 only：heartbeat + pull + result）。
- 行为：拉到 task 后，经现有 `workpanelClient` **真实** `POST` 到配置的 canary（`127.0.0.1:8081`）目标群/Agent；把 WP 受理或 Agent 可见回文写入 `tasks/result` 的 `content`。
- **验收门禁**（无 mock WP）：对齐既有 `npm run test:canary` 风格——本机 canary 必须在、禁止配置 `:8080`；`POST /v1/chat` → 适配器实打 WP → `GET /v1/messages` 出现 **非 echo 占位** 的真实下行（至少含 WP 返回的 id/正文/错误原文）。
- 人工验收：对灰度群发一条可辨认 prompt，在 WP 群线程和 `/v1/messages` 两边都能对上。
- 单元 `npm test` 仍可用内存桩防回归，**不能**替代上述实调用验收。

## 8. 代码与文档触及面（实现阶段，本期只列）

- `src/relay/runners.js` / `schema.sql` / `handlers.js` / `server.js`：去硬编码、串行、TTL、down message。
- `config/relay.example.json`：`agentType` 示例改为通用。
- `docs/api-relay.md`、`docs/bridge-deepseek-harness.md`：dsh = 一种未来 Runner，不是槽位本身。
- 不改 WorkPet UI（控制台另稿）；不改生产 `relay.json`。

## 9. 验收

1. **实调用**：canary WP 在线时，绑定 runner 的 chat 会在 **WP 群内留下真实消息**，且 `/v1/messages` 有对应全文/WP 回执。  
2. 适配器进程停掉超过 TTL 后，再 chat **不入队**（503 `runner_offline`）。  
3. 同 agent 第二条在第一条 `result` 前保持 `queued`。  
4. 未绑定实例仍走直连 WP 投递（现有门禁不回归）。  
5. 文档不再把 `/v1/agents/*` 写成「仅 dsh」；验收记录写明 **无 mock**。

## 10. 非目标（E2）

- 完整 ACP、真实 dsh、家宽入站、nginx/安全组  
- E3 A2A / 非 AI 协调 Agent  
- E4 Raft / 双机  
- Connecter 内嵌模型  

## 11. 与 E3 / E4 的衔接（不在本期实现）

- **E3**：跨 WP 仍走协调门面；Runner 槽不变。  
- **E4**：dsh 作为 **一种** Runner 实现同一 pull API 并做自举；中继 HA 另立项。

## 12. 风险

| 风险 | 缓解 |
|------|------|
| 旧配置 `agentType=dsh` 升级后挂 | 兼容读写旧值 |
| canary 宕机导致 E2 无法验收 | 验收脚本失败即停，不回退到 echo mock |
| 503 vs 静默回落 WP 争议 | 默认 503，避免再打满小云机；若需回落再改配置开关 |
