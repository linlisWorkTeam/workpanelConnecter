# 协同 WorkPanel 仓 — E2 全文回显（Connecter cs，2026-08-19）

> 文档状态：2026-08-19 跨仓协作快照。当前 Runner/federation 状态见 `P0-P3-IMPLEMENTATION-STATUS.md`。

> Connecter 本期 **可以不改 WP 就开工**：用现有 `POST /api/messages` + `GET /api/groups/{id}/messages` 轮询 Agent 回复。  
> 下列项 **不是 E2 开工阻塞**；做了能少轮询、少踩游标坑。请 WP 同事按需排期。

## Connecter 已实测（canary `:8081`，只读）

| API | 现状 |
|-----|------|
| `POST /api/auth/login` | 可用 |
| `POST /api/messages` | 可用；返回后 Agent run **异步** |
| `GET /api/groups/{id}` | 可用（含 members） |
| `GET /api/groups/{id}/messages` | 可用，但 **必须** `beforeCreatedAt` + `beforeId`，否则 400：`beforeCreatedAt and beforeId are required for older pages` |
| Agent 回复 | `parentRunId` 指向调度 run；正文常为 `{"v":1,"parts":[{"channel":"final","text":"..."}]}` |

Connecter E2 轮询策略：派发后记下 `runIds[0]`，扫最新一页消息，匹配 `parentRunId`，解开 `parts[].text`。

## 请 WP 仓考虑的改动（可选，按收益）

### P0 体验（建议，不阻塞）

1. **最新一页免游标**  
   `GET /api/groups/{id}/messages?limit=20`（不带 before*）返回最新消息。现在 400，Connecter 只能用哨兵 `beforeCreatedAt=9999999999999` + 全 F UUID，脆。

2. **Run 终态查询**  
   `GET /api/runs/{runId}`（或已有等价接口文档化）：`queued|running|completed|failed` + 最终文本。Connecter 可少刷群消息。

### P1 少轮询（E3 更好）

3. **Agent run 完成回调 Connecter**  
   WP → `POST {connecter}/v1/wp/runs`（鉴权另定）推 `{ runId, groupId, status, content }`。有它就可以去掉中继侧 30–60s 轮询。  
   **未做时 Connecter 自己 poll，不要求你们改。**

### 明确不需要 WP 做的

- 不必为 DSH 开协议  
- 不必让 Connecter 直连工作 Agent  
- 不要为这次验收改 prod `:8080`

## Pet = 用户（Connecter + WP 已对齐代码；canary 需发布 WP）

产品规则：Pet 输入 = 用户在群里说话；Pet 在线 = 该 WP 用户在线。**不用** `kind=pet` 新枚举（`kind=user` + `authUserId` 即等价）。

Connecter（本仓）：

- `pets[].wpAuth` 登录该 WP 用户；`POST /api/messages` 的 `senderMemberId` = 其绑定成员（不再优先群 owner）
- 每次 members/chat 调 `POST /api/presence/heartbeat`（WP 未部署时 404 则跳过）
- 无 `wpAuth` 时仍用门面 `backends.*.auth`；灰度群 owner「我」若 `authUserId` 为空则 **回退 owner**（现状）

WP（`/AI/LinlisWorkPanel`，**未发 canary**）：

- `POST /api/presence/heartbeat`：把当前登录用户写入 presence，TTL 90s
- `GET /api/presence` 合并 WebSocket + HTTP TTL
- 不新增 `kind=pet`；请把真人成员的 `auth_user_id` 绑上（灰度 owner「我」目前为 null，root 代发仍显示「我」且 WP UI 可能显示离线）

实现方：Connecter **cs** + WP 仓同一改动。规格：G12 / `docs/superpowers/specs/2026-08-19-workpet-group-console-design.md` §8。
