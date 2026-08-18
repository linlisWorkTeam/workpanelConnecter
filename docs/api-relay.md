# Connecter Relay API（对外契约）

> 状态：**P0.2 冻结（2026-08-07）**；**WorkPet 群控制台冻结（2026-08-19）** — 与当前实现一致  
> Base URL：开发 `http://<host>:9080`；生产经 nginx `http://<host>/v1/...`（同路径）  
> 规范交叉：`docs/workconnector-system-design.md` · N1 配置注册 · N2 轮询 · N3 SQLite · `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md`

## 1. 通则

| 项 | 约定 |
|----|------|
| 协议 | HTTP/1.1 · JSON · UTF-8 |
| 鉴权 | `Authorization: Bearer <token>`（除 health） |
| Token 类型 | **pet**：`relay.json` → `pets[].token`；**ops**：`auth.tokens[]` |
| 默认环境 | `canary`；pet 访问 `prod` 且 `allowProdFromPet=false` → **403** `PROD_FORBIDDEN` |
| 幂等 | `POST /v1/chat` 的 `id`（建议 `msg_<uuid>`）为全局幂等键 |
| 错误体 | `{ "error": "<string>", "code": "<optional>" }` |

### 1.1 鉴权矩阵

| 路径 | 匿名 | pet token | ops token |
|------|------|-----------|-----------|
| `GET /v1/health` | ✅ | ✅ | ✅ |
| `GET /v1/envs` | ❌ | ✅ | ✅ |
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

pet token 对 `/v1/groups*` 与扩展后的 `POST /v1/chat` 的可读可写范围 = **该 env 上门面账号在 WorkPanel 可见的全部群**，**不限于** `relay.json` → `pets[].groups` 绑定行。`agent_instances` 仍用于默认值班 Agent 解析与 ack 路由，**不再**作为「能否进入该群」的门槛。

---

## 2. 端点

### `GET /v1/health`

探活，无需鉴权。

```json
{ "ok": true, "service": "connecter-relay" }
```

### `GET /v1/envs`

列出已配置 backend（无密码）。

**200**

```json
{
  "envs": [{ "name": "canary", "baseUrl": "http://127.0.0.1:8081", "kind": "workpanel" }],
  "defaults": { "env": "canary", "group": "灰度测试", "coordinatorAgentName": "Cursor Agent" }
}
```

### `GET /v1/instances`（pet）

本 pet 在配置中绑定的 `agent_instances`。

**200** `{ "instances": [ { "id", "pet_id", "env", "group_id", "group_name", "agent_name", "status" } ] }`

### `GET /v1/groups?env=`（pet · 群控制台）

代理 WP `GET /api/groups`。`env` 缺省 canary。

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
| `agent` / `agentName` | 否 | 显式值班 Agent；否则由 `@` 解析或协调者回退 |
| `petName` | 否 | 最长 32 字，写入戳记；缺省 `WorkPet` |

**@ 与协调者（pet）**

1. 从 `prompt` 按群成员 `displayName` 最长匹配 `@`；命中须为 `kind=agent`，否则 **400** `UNKNOWN_MENTION`（不转发 WP）。  
2. 无 `@`：用请求体 `agent`/`agentName`（若有）→ env `defaults.coordinatorAgentName` → 群内第一个 `kind=agent && isActive`；都没有 → **400** `NO_COORDINATOR`。（启动时 `relay.json` 绑定仍 upsert 默认 `agent_instances`；chat 解析不再以绑定行作为进群门槛。）  
3. 转发 WP 的正文形如：`@{agent}\n【WorkPet:{petName}】\n{rest}`。

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

`mentionedAgent` = 实际投递的 Agent 显示名（含 `@` 解析或协调者回退结果）。

**幂等重放 200**：同 `id` 已存在 → `idempotent: true`，不二次转发 WP。  
**投递失败**：可能 **502**（已死信，或 WP 群代理失败 `WP_GROUPS_FAILED`）或 **202**（仍 accepted 待续投）。  
**403** `PROD_FORBIDDEN` · **401** 无/坏 token · **429** chat 限流 · **400** 缺 prompt / `UNKNOWN_MENTION` / `NO_COORDINATOR` / 无匹配群。

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

## 3. 注册（MVP = 配置，无 HTTP register）

`config/relay.json`：

```json
"pets": [{
  "id": "pet-dev-1",
  "token": "<secret>",
  "groups": [
    { "env": "canary", "groupId": "<uuid>", "groupName": "灰度测试", "agentName": "Cursor Agent" }
  ]
}]
```

启动时 upsert `pets` / `agent_instances` / `sessions`。动态 `POST /v1/register` = 二期。  
`pets[].groups` 仍是默认值班绑定；**不**限制 `/v1/groups*` 或 chat 的门面可见群范围（见 §1.3 G11）。

---

## 4. 客户端最小闭环（WorkPet）

**收起态 / ack 调度（G10，不变）**

1. `GET /v1/health`  
2. `POST /v1/chat`（带稳定 `id`）  
3. 循环 `GET /v1/messages?since=<cursor>&group=…` 直到看到 down ack 或超时  
4. 可选 `GET /v1/runs/<runId>`  

**展开面板 / 群控制台（P2.4）**

1. `GET /v1/groups?env=` 填群下拉  
2. `GET /v1/groups/:id` 成员 + 在线；`GET /v1/groups/:id/messages` 为主 transcript（约 2s 轮询）  
3. 发送仍走扩展后的 `POST /v1/chat`（`petName`、可选 `@Agent`）；ack 仍可另轮询 `GET /v1/messages`  

示例见根 `README.md`；配置样例 `docs/workpet-config-sample.md` / `apps/workpet/config.example.json`。

---

## 5. E1 Runner API（dsh 出站注册表）

> 状态：**E1 已代码落地**（`src/relay/runners.js` + `/v1/agents/*` + 门禁 `npm run test:runner`）；设计见 `docs/bridge-deepseek-harness.md` §4.4。
> 与 pet 的 `/v1/*` 契约并存；Runner 使用独立 token（预配于 `config.runners`）。

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

## 6. 非目标（本契约版本）

- WebSocket、WP→Connecter 回调、动态注册审批  
- Connecter 业务网页  
- 保证 Agent 自然语言全文已在 `/v1/messages`（仅保证调度受理与 ack）  
- WP Pet 成员身份 / WorkPet 登录（G12 · 见 NEXT **P2.5**，本期不实现）  
