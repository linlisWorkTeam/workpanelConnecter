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
  "groups": [
    { "env": "canary", "groupId": "<uuid>", "groupName": "灰度测试", "agentName": "Cursor Agent" }
  ]
}]
```

启动时 upsert `pets` / `agent_instances` / `sessions`。动态 `POST /v1/register` = 二期。

---

## 4. 客户端最小闭环（WorkPet）

1. `GET /v1/health`  
2. `POST /v1/chat`（带稳定 `id`）  
3. 循环 `GET /v1/messages?since=<cursor>&group=…` 直到看到 down ack 或超时  
4. 可选 `GET /v1/runs/<runId>`  

示例见根 `README.md`；配置样例 `docs/workpet-config-sample.md` / `apps/workpet/config.example.json`。

---

## 5. 非目标（本契约版本）

- WebSocket、WP→Connecter 回调、动态注册审批  
- Connecter 业务网页  
- 保证 Agent 自然语言全文已在 `/v1/messages`（仅保证调度受理与 ack）  
