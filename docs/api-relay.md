# Connecter Relay API（对外契约）

> 状态：**P0.2 冻结（2026-08-07）**；**WorkPet 群控制台冻结（2026-08-19）** — 与当前实现一致
> 命名（2026-08-19）：本 API 是 **Connecter**（站点）的 pet/ops/runner 面。**Connecter Host** 是另一角色（Connecter↔Connecter，协议未开）。单站合署时桌宠打的仍是 Connecter。规格：`docs/superpowers/specs/2026-08-19-connecter-host-naming-design.md`。
> Base URL：开发 `http://<host>:9080`；生产经 nginx `http://<host>/v1/...`（同路径）
> 规范交叉：`docs/workconnector-system-design.md` · N1 配置注册 · N2 轮询 · N3 SQLite · `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md`

## 1. 通则

| 项 | 约定 |
|----|------|
| 协议 | HTTP/1.1 · JSON · UTF-8 |
| 鉴权 | `Authorization: Bearer <token>`（除 health、`POST /v1/auth/login`） |
| Token 类型 | **pet**：`relay.json` → `pets[].token`，或登录签发；**ops**：`auth.tokens[]` |
| 默认环境 | `canary`；pet 访问 `prod` 且 `allowProdFromPet=false` → **403** `PROD_FORBIDDEN` |
| 幂等 | `POST /v1/chat` 的 `id`（建议 `msg_<uuid>`）为全局幂等键 |
| 错误体 | `{ "error": "<string>", "code": "<optional>" }` |

### 1.1 鉴权矩阵

| 路径 | 匿名 | pet token | ops token |
|------|------|-----------|-----------|
| `GET /v1/health` | ✅ | ✅ | ✅ |
| `POST /v1/auth/login` | ✅（WP 用户名密码） | — | — |
| `GET /v1/envs` | ❌ | ✅ | ✅ |
| `POST /v1/host/peers/register` | ✅（body token） | ❌ | ❌ |
| `POST /v1/host/peers/heartbeat` | ❌ | ❌ | peer token |
| `GET /v1/host/peers` | ❌ | ❌ 403 | ✅ |
| `GET /v1/instances` | ❌ | ✅（仅本 pet） | ❌ 403 |
| `GET /v1/groups` | ❌ | ✅ | ❌ 403 |
| `GET /v1/groups/:id` | ❌ | ✅ | ❌ 403 |
| `GET /v1/groups/:id/messages` | ❌ | ✅ | ❌ 403 |
| `POST /v1/chat` | ❌ | ✅ | ✅（legacy 直路由） |
| `GET /v1/messages` | ❌ | ✅ | ❌ 403 |
| `GET /v1/runs/:id` | ❌ | ✅ | ✅ |
| `GET /v1/logs` | ❌ | ✅ | ✅ |
| `POST /v1/session/revoke` | ❌ | ✅ | ❌ 403 |

ops 访问 `/v1/groups*` → **403** `{ "error": "pet token required" }`（与 `/v1/instances` 相同门禁）。

### 1.2 Rate limit（pet）

| 桶 | 适用路径 | 默认 | 超限 |
|----|----------|------|------|
| `chat` | 除 `/v1/groups*` 外的 pet 请求（含 `POST /v1/chat`、`GET /v1/messages`） | **60** req/min/pet | **429** |
| `console` | `GET /v1/groups`、`GET /v1/groups/:id`、`GET /v1/groups/:id/messages` | **120** req/min/pet | **429** |

控制台只读 GET **不计入** chat 60 限额，避免展开面板 2s 轮询堵住发送。

### 1.3 群可见范围（G11）

pet token 对 `/v1/groups*` 与 `POST /v1/chat` 的可读可写范围 = **当前登录 WP 用户作为成员的群**（Connecter 用登录 overlay / `pets[].wpAuth` 代登 WP），**不限于** `relay.json` → `pets[].groups`，也**不再**等于门面账号能看见的全部群。非成员访问群详情 / 消息 / 发言 → **403** `NOT_IN_GROUP`。成员判定优先 `authUserId ===` 登录 `userId`；群内尚无人绑定 `authUserId` 时回退为信任 WP 列表（canary 「我」常见未绑）。`agent_instances` 仍用于 ack 路由。

---

## 2. 端点

### `GET /v1/health`

探活，无需鉴权。

```json
{
  "ok": true,
  "service": "connecter-relay",
  "host": { "role": "host|connecter|standalone", "linked": true, "siteId": "windows-dev", "lastError": null }
}
```

站点 Connecter 出站加入 Host：`POST /v1/host/peers/register` `{ siteId, token }`（Host `host.peers[]` 预配）；心跳 `POST /v1/host/peers/heartbeat`（peer bearer）。ops `GET /v1/host/peers`。本站聊天仍不经 Host。

### `POST /v1/auth/login`（匿名）

WorkPet 用 WP 用户名密码登录。Connecter 代登当前 env 的 WP，签发/复用 pet token，并把凭据放进进程内 overlay（**不**写 git、不回传密码）。Connecter 重启后需再登。

**Body** `{ "username": "<WP>", "password": "<WP>", "env": "canary" }`

**200** `{ "token", "petId", "username", "userId", "env" }`
**400** 缺字段 · **401** `LOGIN_FAILED` · **403** `PROD_FORBIDDEN`

### `GET /v1/envs`

列出 WP 槽位（`relay.json` backends ∪ 心跳未过期的自注册），**无密码**。每项带 `alive`（探 `GET {baseUrl}/api/health`）和 `source`（`config` | `register`）。

**200**

```json
{
  "envs": [{
    "name": "canary",
    "baseUrl": "http://127.0.0.1:8082",
    "kind": "workpanel",
    "source": "register",
    "alive": true
  }],
  "defaults": { "env": "canary", "group": "灰度测试", "coordinatorAgentName": "Cursor Agent" }
}
```

WorkPet 不下发 prod。桌宠不扫描局域网。

### `POST /v1/backends/register`（ops）

本机/旁路 WP **出站**登记槽位（覆盖同名静态 backend 的 baseUrl）。TTL 默认 90s（`wpSlotHeartbeatTtlSec`）。

**Body** `{ "name": "canary", "baseUrl": "http://127.0.0.1:8082", "kind": "workpanel", "auth": { "username": "...", "password": "..." } }`
`auth` 可省略（沿用该槽已登记或 `relay.json` 门面账号）。禁止 `name=prod`。

**200** `{ "ok": true, "slot": { "name", "baseUrl", "kind" } }`

### `POST /v1/backends/heartbeat`（ops）

**Body** `{ "name": "canary" }` → **200** `{ "ok": true, "name": "canary" }`。未知槽 **404**。

本地登记：`npm run wp-slot -- --baseUrl http://127.0.0.1:8082 --name canary`（读 `relay.json` ops token，可 `--loop`）。

### `GET /v1/instances`（pet）

本 pet 在配置中绑定的 `agent_instances`。

**200** `{ "instances": [ { "id", "pet_id", "env", "group_id", "group_name", "agent_name", "status" } ] }`

### `GET /v1/groups?env=`（pet · 群控制台）

代理 WP `GET /api/groups`，再按登录用户成员身份过滤。`env` 缺省 canary。非成员群不会出现在列表里。

**200**

```json
{
  "env": "canary",
  "groups": [
    { "id": "<uuid>", "name": "灰度测试", "unreadCount": 0 }
  ]
}
```

WP 若无 `unreadCount` 则字段省略。
**502** `{ "error": "…", "code": "WP_GROUPS_FAILED" }` · **403** ops / `PROD_FORBIDDEN` · **429** console 限流。

### `GET /v1/groups/:id?env=`（pet · 群控制台）

代理 WP `GET /api/groups/{id}` + `GET /api/presence`。

**200**

```json
{
  "env": "canary",
  "group": { "id": "<uuid>", "name": "灰度测试" },
  "members": [
    {
      "id": "<memberId>",
      "displayName": "Cursor Agent",
      "kind": "agent",
      "isActive": true,
      "online": true
    }
  ],
  "coordinatorAgent": "Cursor Agent"
}
```

`online`：`kind=agent` 时等于 `isActive`；`kind=user` 时 `id` 或 `userId` ∈ presence `onlineUserIds`。presence 失败则用户 `online` 全为 `false`，仍返回成员列表。
`coordinatorAgent`：与 chat 相同的 isActive 规则——`defaults.coordinatorAgentName` 须在群内且 `kind=agent && isActive`，否则取第一个活跃 agent。
群不存在或不在门面可见范围 → **404**。
**502** `WP_GROUPS_FAILED` · **403** ops / `PROD_FORBIDDEN`。

### `GET /v1/groups/:id/messages?env=&limit=`（pet · 群控制台）

代理 WP `GET /api/groups/{id}/messages`。`limit` 默认 50，最大 100。群历史**不**镜像进 Connecter SQLite。

**200**

```json
{
  "messages": [
    {
      "id": "…",
      "ts": "…",
      "senderMemberId": "…",
      "senderDisplayName": "…",
      "senderKind": "user|agent",
      "content": "…",
      "contentDisplay": "…",
      "petDisplayName": "林的Pet",
      "mentionMemberIds": []
    }
  ]
}
```

| 附加字段 | 说明 |
|----------|------|
| `petDisplayName` | 正文含戳记行 `【WorkPet:{petName}】` 时为戳记名，否则 `null` |
| `contentDisplay` | 去掉戳记行后的正文，供桌宠渲染 |

群不存在或不在门面可见范围 → **404**。
**502** `WP_GROUPS_FAILED` · **403** ops / `PROD_FORBIDDEN`。

> 此接口是 WorkPet 展开面板的主 transcript；**不是** G10 ack 轮询（ack 仍走 `GET /v1/messages`）。

### `POST /v1/chat`

上行发消息 → 落盘 → 转发 WorkPanel → 受理回执。

**Body**

| 字段 | 必填 | 说明 |
|------|------|------|
| `prompt` 或 `content` | 是 | 不透明文本；可含 `@Agent显示名` |
| `id` | 建议 | 幂等键；缺省服务端生成 `msg_*` |
| `env` | 否 | 默认 canary；pet+prod 可能 403 `PROD_FORBIDDEN` |
| `group` / `groupId` | pet 建议 | 门面可见的任意群（id 或 name）；**不要求**已有 `agent_instances` 行 |
| `agent` / `agentName` | 否 | 展开面板可不传；无 `@` 时忽略，改打群管理员 |
| `petName` | 否 | 最长 32 字，写入戳记；缺省 `WorkPet` |

**@ 与管理员（pet）**

1. 从 `prompt` 按群成员 `displayName` 最长匹配 `@`（`@` 前须为空或空白）；命中须为 `kind=agent`，否则 **400** `UNKNOWN_MENTION`（不转发 WP）。
2. 无 `@`：只投递群 `adminMemberId` 且该成员为在线 Agent；否则 **400** `NO_ADMIN`（不再回落到「任意第一个 Agent」）。
3. 发送身份：`pets[].wpAuth` 登录的 WP 用户（绑定 `authUserId`）；省略则回落门面 `backends.*.auth`。
4. 转发 WP 的正文形如：`@{agent}\n【WorkPet:{petName}】\n{rest}`。

**Pet 成功 200**

```json
{
  "status": "accepted",
  "env": "canary",
  "messageId": "msg_…",
  "seq": 1,
  "runIds": ["…"],
  "wpMessageId": "…",
  "group": "<group_id>",
  "coordinatorAgent": "Cursor Agent",
  "mentionedAgent": "Cursor Agent"
}
```

`coordinatorAgent` = 实际投递的 Agent。`mentionedAgent` = 正文里 `@` 命中的 Agent，无 `@` 时为 `null`。

**幂等重放 200**：同 `id` 已存在 → `idempotent: true`，不二次转发 WP。
**投递失败**：可能 **502**（已死信，或 WP 群代理失败 `WP_GROUPS_FAILED`）或 **202**（仍 accepted 待续投）。
**403** `PROD_FORBIDDEN` · **401** 无/坏 token · **429** chat 限流 · **400** 缺 prompt / `UNKNOWN_MENTION` / `NO_ADMIN` / 无匹配群。

### `GET /v1/messages?since=&group=&env=&agent=&limit=`

下行/历史上行轮询（N2 · **G10 ack 契约，不变**）。`since` = 上一批 `nextCursor`（消息 `seq`）；缺省 0。

**200**

```json
{
  "agentInstanceId": "pet-dev-1:canary:…:Cursor Agent",
  "since": 0,
  "nextCursor": 8,
  "messages": [
    {
      "seq": 1,
      "id": "msg_…",
      "direction": "up|down",
      "status": "accepted|delivered|failed",
      "envelope": { "id", "type", "direction", "conversation", "from", "to", "payload", "ts", "ack" },
      "created_at": "…"
    }
  ]
}
```

客户端应持久化 `nextCursor`，断线后带 `since` 续拉（不丢不重）。

> MVP 下行常见为投递 ack（`payload.content` 内含 `delivery.ack`）；Agent 全文回显见 NEXT P2.3。群聊 transcript 见 `GET /v1/groups/:id/messages`（G9），勿与本接口混用。

### `GET /v1/runs/:id`

按 runId 或 messageId 查库记录。

### `GET /v1/logs?limit=`

最近消息行（运维）；默认 10。

### `POST /v1/session/revoke`（pet）

吊销该 pet 全部 session；之后同 token → **401**，直至改配置 token 并重启中继重新 bootstrap。

**200** `{ "ok": true, "petId": "…", "status": "revoked" }`

---

## 3. 身份、注册与接入

`config/relay.json`：

```json
"pets": [{
  "id": "pet-dev-1",
  "token": "<secret>",
  "wpAuth": { "username": "<WP 登录名>", "password": "<WP 密码>" },
  "groups": [
    { "env": "canary", "groupId": "<uuid>", "groupName": "灰度测试" }
  ]
}]
```

`wpAuth` = 该桌宠对应的 **WP 用户**（群里 `kind=user` 且 `authUserId` 已绑定）。省略时回落 `backends.*.auth` 门面账号。WorkPet **不**直连 WP：登录走 `POST /v1/auth/login`，之后只用 pet token。

启动时仍会 upsert `pets` / `agent_instances` / `sessions`。当前没有通用 `POST /v1/register`；不同主体使用各自的受限接入协议：Runner 使用 `POST /v1/agents/register` 或 Directory v2 enrollment/device credential，Site peer 使用 `POST /v1/host/peers/register`，WorkPanel backend 使用 ops `POST /v1/backends/register`。
`pets[].groups` 仍是默认值班绑定；**不**扩大可见范围。可见范围见 §1.3 G11（自己所在的群）。

`GET /v1/members`：`selfMemberId` + 成员 `self` / `online`（用户在线来自 WP `GET /api/presence`；Pet 心跳 `POST /api/presence/heartbeat`）。展开面板主路径仍是 `GET /v1/groups*`。

---

## 4. 客户端最小闭环（WorkPet）

**收起态 / ack 调度（G10，不变）**

1. `GET /v1/health`
2. `POST /v1/chat`（带稳定 `id`）
3. 循环 `GET /v1/messages?since=<cursor>&group=…` 直到看到 down ack 或超时
4. 可选 `GET /v1/runs/<runId>`

**展开面板 / 群控制台（P2.4）**

0. `POST /v1/auth/login`（未登录不拉群）
1. `GET /v1/groups?env=` 填群下拉（仅自己所在的群）
2. `GET /v1/groups/:id` 成员 + 在线；`GET /v1/groups/:id/messages` 为主 transcript（约 2s 轮询）
3. 发送仍走扩展后的 `POST /v1/chat`（`petName`、可选 `@Agent`）；ack 仍可另轮询 `GET /v1/messages`

示例见根 `README.md`；配置样例 `docs/workpet-config-sample.md` / `apps/workpet/config.example.json`。

---

## 5. E1/E2 Runner API（出站注册表）

适配层请读 **[`docs/protocol/runners.md`](./protocol/runners.md)**（请求/响应 JSON、串行、TTL、两段 result）。配置字段见 **[`docs/relay-config.md`](./relay-config.md)** / `config/relay.schema.json`。

> 状态：**E1 骨架 + E2 可插拔/串行/TTL/两段下行**（`src/relay/runners.js` + `scripts/wp-runner.js` + `npm run test:runner` / `npm run test:e2-canary`）。
> Runner **不**绑定 dsh；dsh 只是未来一种实现。

| 方法 | 路径 | 鉴权 | 用途 |
|------|------|------|------|
| POST | `/v1/agents/register` | 匿名（body token 校验） | dsh 动态注册：`{ agentId, token, groups:[{env, groupId|groupName, agentName}] , runtime? }` |
| POST | `/v1/agents/heartbeat` | runner bearer | 心跳续命（TTL 默认 60s） |
| POST | `/v1/agents/tasks` | runner bearer | **出站拉任务**：→ `{ tasks:[{taskId, prompt, context, env, groupId, agentName, upMessageId}] }`，同时置 dispatched |
| POST | `/v1/agents/tasks/result` | runner bearer | 回结果：`{ taskId, status: completed\|failed\|cancelled, content }` → 下 plain echo + run 终态 + best-effort 回写 WP 群线程（E2） |
| GET  | `/v1/agents?env=&group=` | ops bearer | 运维查询注册表（bindings） |

**register 成功 200**

```json
{ "agentId": "dsh-…", "channelId": "ch_…", "role": "general",
  "taskUrl": "…/v1/agents/tasks", "heartbeatUrl": "…/v1/agents/heartbeat" }
```

**错误**：`401` token 错/坏 · `403` agentId 未预配 · `409` special 唯一冲突 / 每群已有 √一 general · `400` 缺字段。

> 预配形态：`config/relay.json` → `runners: [{ agentId, token, role: "special"|"general", runtime, bindings:[{env, groupId, groupName, agentName}] }]`，启动即 upsert；`role=special` 全局唯一（仅绑定 WorkPanel 自身维护群），`role=general` 每个 (env, group, agent) 至多一个。

---

## 6. Directory v2、联邦与运维 API

详细字段以协议文档和 handler 为准：

- Directory/enrollment：`POST /v2/enrollments`、`GET /v2/ops/enrollments/:id`、`DELETE /v2/ops/enrollments/:id`、`GET /v2/directory/subjects`、`GET /v2/directory/endpoints`、`GET /v2/routes/explain`；
- credential：`POST /v2/credentials/rotate`、`POST /v2/ops/credentials/:id/revoke`；
- federation：`POST /v1/federation/messages`、`POST /v1/federation/pull`、`POST /v1/federation/ack`、`POST /v1/federation/result`、`POST /v1/federation/directory/advertise`、`GET /v1/federation/directory`；
- task ops：`GET /v1/ops/tasks`、`POST /v1/ops/tasks/:id/requeue`、`POST /v1/ops/tasks/:id/cancel`；
- federation ops：`GET /v1/ops/federation/outbox`、`POST /v1/ops/federation/outbox/:id/requeue`、策略、Host peer revoke/rotate、安全投递清单、health detail 和 trace。

协议入口：[`protocol/directory-v2.md`](./protocol/directory-v2.md)、[`protocol/federation-v1.md`](./protocol/federation-v1.md)、[`protocol/runners.md`](./protocol/runners.md)。

### 6.1 P3 federation operations

All endpoints below require an ops bearer token.

- `GET /v1/ops/federation/policies?status=&limit=` lists active or disabled rules without credentials or message payloads.
- `POST /v1/ops/federation/policies` creates a rule with `originSite`, `targetSite`, `groupRef`, optional `subjectId`, `operation`, `direction`, `capability`, `dataClassification`, `effect`, and `version`.
- `POST /v1/ops/federation/policies/:id/disable` disables a rule without deleting its history.
- `POST /v1/ops/host/peers/:siteId/revoke` immediately revokes a registered Site credential and prevents config-based re-registration.
- `POST /v1/ops/host/peers/:siteId/rotate` accepts `{ "token": "..." }`, invalidates the old bearer and requires the Site to switch to the new credential. Both operations are audited; token bodies are redacted.
- `GET /v1/ops/security/deliveries?siteId=&keyId=&status=&since=&until=&limit=` returns the affected-delivery inventory for incident response.
- `GET /v1/ops/health/detail` returns queue, lease, retry, dead-letter, ACL, latency and WorkPanel write-back metrics.
- `GET /v1/ops/traces/:traceId` returns route, audit and telemetry records across the live and archived audit sets.

## 7. 非目标（本契约版本）

- Connecter 业务网页或内嵌业务 Agent；
- Host 接收 WorkPet、WorkPanel 或 Runner 执行接口；
- 默认访问 prod 或由 Connecter 修改 WorkPanel 发布槽；
- WebSocket/SSE（当前保持 `since` 轮询兼容）；
- 通用、无边界的 `/v1/register`；接入必须使用主体专用的 Runner、Site peer、backend 或 enrollment 协议。
