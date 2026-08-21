# Runner 出站协议（适配层）

> Connecter 只做队列与路由。Runner（`wp-runner`、以后的 dsh、其它 Agent）**只出站**拉任务。  
> 实现：`src/relay/runners.js` · 门禁：`npm run test:runner` · HTTP 总表：`docs/api-relay.md` §5

## 1. 鉴权

| 步骤 | 鉴权 |
|------|------|
| `POST /v1/agents/register` | 匿名；body 里的 `token` 必须等于 `relay.json` → `runners[].token`（该 `agentId` 须已预配） |
| `POST /v1/agents/heartbeat` | `Authorization: Bearer <同一 runner token>` |
| `POST /v1/agents/tasks` | 同上 |
| `POST /v1/agents/tasks/result` | 同上 |
| `GET /v1/agents` | **ops** bearer（`auth.tokens[]`），不是 runner |

错误：`401` token 错 · `403` agentId 未预配 / 非 runner token · `409` special 全局唯一或 (env, group, agent, role) 已有 general。

## 2. 生命周期

```text
预配 runners[] ──► POST /register（幂等 upsert 绑定）
                 ──► 循环：heartbeat（TTL 默认 60s）
                 ──► POST /tasks  （空数组 = 无活；有则最多 1 条 dispatched）
                 ──► 执行
                 ──► POST /tasks/result  running|accepted（可选第一段）
                 ──► POST /tasks/result  completed|failed|cancelled
```

同 `runnerId` **最多 1 条 in-flight**（`dispatched` 未终态则 `/tasks` 再拉得到 `tasks: []`）。心跳过期后新 chat **不入队**，对绑定该 runner 的目标返回 **503** `runner_offline`（不静默打云 WP）。

## 3. `POST /v1/agents/register`

**请求**

```json
{
  "agentId": "wp-canary-runner",
  "token": "<预配 token>",
  "runtime": "local",
  "agentType": "workpanel",
  "groups": [{ "env": "canary", "groupId": "<uuid>", "groupName": "灰度测试", "agentName": "Cursor Agent" }]
}
```

`groups` 可省略，则用预配 `bindings`。`agentType` 默认 `runner`；旧值 `dsh` 仍合法。

**200**

```json
{
  "agentId": "wp-canary-runner",
  "channelId": "ch_…",
  "role": "general",
  "taskUrl": "http://…/v1/agents/tasks",
  "heartbeatUrl": "http://…/v1/agents/heartbeat"
}
```

`role`：`special` 全表至多一条（WorkPanel 自维护群）；`general` 每个 `(env, groupId, agentName)` 至多一个。

## 4. `POST /v1/agents/heartbeat`

Body 可空 `{}`。**200** `{ "ok": true, "agentId", "channelId" }`。TTL：`runnerHeartbeatTtlSec`（默认 60）。

## 5. `POST /v1/agents/tasks`

Query `?limit=` 可选，默认 1，最大 50。有 in-flight 时仍 **200** 且 `tasks` 为空（不是 409）。

**200（契约：永远是对象，不是顶层数组）**

```json
{
  "tasks": [
    {
      "taskId": "msg_…",
      "prompt": "用户原文（无桌宠戳记）",
      "context": { "source": "pet-chat" },
      "env": "canary",
      "groupId": "<uuid>",
      "agentName": "Cursor Agent",
      "upMessageId": "msg_…"
    }
  ]
}
```

无任务：`{ "tasks": [] }`。HTTP 状态码为 **200**；`status`/`body` 是中继内部 handler 信封，**不会**出现在 JSON 里。

## 6. `POST /v1/agents/tasks/result`

```json
{
  "taskId": "msg_…",
  "status": "running",
  "content": "第一段：例如 WP 已受理",
  "writeBack": false
}
```

| `status` | 任务行 | 下行 |
|----------|--------|------|
| `running` / `accepted` | 仍为 `dispatched` | 一段 down，Pet 可 poll 到 |
| `completed` / `failed` / `cancelled` | 终态 | 再一段 down；默认 best-effort `postAsAgent` 回 WP（`writeBack: false` 可关） |

**200** 终态约 `{ "ok": true, "status": "completed", "taskId" }`。`404` 无任务 · `403` 非本 runner · `409` 已终态。

## 7. 适配器最小循环

见 `scripts/wp-runner.js`：register（若动态）→ heartbeat 定时 → POST tasks → 调 WP 或本地执行 → result。不要对 Connecter 开入站端口。

配置预配见 `config/relay.schema.json` 的 `runners`。
