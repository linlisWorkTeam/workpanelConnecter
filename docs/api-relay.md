# Connecter Relay API（对外契约）

> 状态：**P0.2 冻结（2026-08-07）** — 与当前实现一致  
> Base URL：开发 `http://<host>:9080`；生产经 nginx `http://<host>/v1/...`（同路径）  
> 规范交叉：`docs/workconnector-system-design.md` · N1 配置注册 · N2 轮询 · N3 SQLite

## 1. 通则

| 项 | 约定 |
|----|------|
| 协议 | HTTP/1.1 · JSON · UTF-8 |
| 鉴权 | `Authorization: Bearer <token>`（除 health） |
| Token 类型 | **pet**：`relay.json` → `pets[].token`；**ops**：`auth.tokens[]` |
| 默认环境 | `canary`；pet 访问 `prod` 且 `allowProdFromPet=false` → **403** |
| 幂等 | `POST /v1/chat` 的 `id`（建议 `msg_<uuid>`）为全局幂等键 |
| 错误体 | `{ "error": "<string>", "code": "<optional>" }` |

### 1.1 鉴权矩阵

| 路径 | 匿名 | pet token | ops token |
|------|------|-----------|-----------|
| `GET /v1/health` | ✅ | ✅ | ✅ |
| `GET /v1/envs` | ❌ | ✅ | ✅ |
| `GET /v1/instances` | ❌ | ✅（仅本 pet） | ❌ 403 |
| `POST /v1/chat` | ❌ | ✅ | ✅（legacy 直路由） |
| `GET /v1/messages` | ❌ | ✅ | ❌ 403 |
| `GET /v1/runs/:id` | ❌ | ✅ | ✅ |
| `GET /v1/logs` | ❌ | ✅ | ✅ |
| `POST /v1/session/revoke` | ❌ | ✅ | ❌ 403 |

Rate limit（pet）：默认 60 req/min/pet → **429**。

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

### `POST /v1/chat`

上行发消息 → 落盘 → 转发 WorkPanel → 受理回执。

**Body**

| 字段 | 必填 | 说明 |
|------|------|------|
| `prompt` 或 `content` | 是 | 不透明文本 |
| `id` | 建议 | 幂等键；缺省服务端生成 `msg_*` |
| `env` | 否 | 默认 canary；pet+prod 可能 403 |
| `group` / `groupId` | pet 建议 | 匹配 `group_id` 或 `group_name` |
| `agent` / `agentName` | 否 | 默认配置值班 Agent |

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
  "coordinatorAgent": "Cursor Agent"
}
```

**幂等重放 200**：同 `id` 已存在 → `idempotent: true`，不二次转发 WP。  
**投递失败**：可能 **502**（已死信）或 **202**（仍 accepted 待续投）。  
**403** `PROD_FORBIDDEN` · **401** 无/坏 token · **429** 限流 · **400** 缺 prompt / 无匹配 instance。

### `GET /v1/messages?since=&group=&env=&agent=&limit=`

下行/历史上行轮询（N2）。`since` = 上一批 `nextCursor`（消息 `seq`）；缺省 0。

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

> MVP 下行常见为投递 ack（`payload.content` 内含 `delivery.ack`）；Agent 全文回显见 NEXT P2.3。

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
  "wpAuth": { "username": "<WP 登录名>", "password": "<WP 密码>" },
  "groups": [
    { "env": "canary", "groupId": "<uuid>", "groupName": "灰度测试" }
  ]
}]
```

`wpAuth` = 该桌宠对应的 **WP 用户**（群里 `kind=user` 且 `authUserId` 已绑定）。省略时回落 `backends.*.auth` 门面账号。WorkPet **不**直连 WP，仍只用 pet token。

`GET /v1/members`：`selfMemberId` + 成员 `self` / `online`（用户在线来自 WP `GET /api/presence`；Pet 心跳 `POST /api/presence/heartbeat`）。

启动时 upsert `pets` / `agent_instances` / `sessions`。动态 `POST /v1/register` = 二期。

---

## 4. 客户端最小闭环（WorkPet）

1. `GET /v1/health`  
2. `POST /v1/chat`（带稳定 `id`）  
3. 循环 `GET /v1/messages?since=<cursor>&group=…` 直到看到 down ack 或超时  
4. 可选 `GET /v1/runs/<runId>`  

示例见根 `README.md`；配置样例 `docs/workpet-config-sample.md` / `apps/workpet/config.example.json`。

---

## 5. E1 Runner API（dsh 出站注册表）

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

## 6. 非目标（本契约版本）

- WebSocket、WP→Connecter 回调、动态注册审批  
- Connecter 业务网页  
- 保证 Agent 自然语言全文已在 `/v1/messages`（仅保证调度受理与 ack）  
