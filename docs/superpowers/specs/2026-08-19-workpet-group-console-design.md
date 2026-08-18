# WorkPet 迷你群控制台 — 设计稿

> 日期：2026-08-19  
> 状态：**已批准**（展开后做成群控制台；Connecter 代理 WP；本宠气泡显示「XXX的Pet」）  
> 相关：`docs/api-relay.md` · `docs/workconnector-system-design.md` · `docs/workpet-connecter-design.md` · `docs/NEXT-DEV-PATH.md`  
> 修正：本规格**取代** 2026-08-05 稿 D2「MVP 只绑一个群的值班 Agent」中的 UI 范围；值班 Agent 仅作为「无 @ 时的默认投递目标」保留。

## 1. 已锁定决策

| # | 决策 |
|---|------|
| G1 | 桌宠仍是主界面；**展开后**是迷你群控制台：切群、成员在线、`@Agent` 调度、最近群消息 |
| G2 | 桌宠**只连 Connecter**（pet token）；不直连 WorkPanel，本期**不做** WorkPet 上的 WP 登录态 |
| G3 | 切群范围 = 门面账号在**当前 env** 的 WP 上能进入的全部群（不限于 `relay.json` 的 `pets[].groups`） |
| G4 | 线上发送仍用现有 Connecter **门面账号**代发（`workpanelClient` 的 sender + `POST /api/messages`） |
| G5 | 控制台里本宠气泡显示配置中的 `petName`（如「林的Pet」），不显示门面用户名 |
| G6 | `@显示名` 只改投递目标（`mentionMemberIds` + 正文 `@`）；对不上则**拒绝发送并提示** |
| G7 | 无 `@` 时行为与现在一致：投配置/群内值班 Agent |
| G8 | 用户在线 = WP `GET /api/presence` 的 `onlineUserIds`；Agent 在线 = 群成员 `isActive` |
| G9 | 最近消息 = 代理 WP `GET /api/groups/{id}/messages`，默认约 50 条；**不**用现有 `GET /v1/messages` ack 日志做主列表 |
| G10 | 现有 `GET /v1/messages` / 幂等 chat / pet→prod 403 不回归 |
| G11 | pet token 可读可写范围升到与门面账号同一组群；必须写进 `api-relay.md` |
| G12 | **下一步（本期不实现）**：WP 承认 Pet 成员身份；WorkPet 再做登录态。见 §8 |

## 2. 目标与非目标

**目标：** 用户在桌宠展开面板里能切换门面可见群、看成员是否在线、用 `@Agent` 调度、阅读最近群消息；本宠发言在面板上显示为 `petName`。

**非目标（本期）：**

- WorkPet / Connecter 实现 WP 用户登录或 Pet 独立成员
- WebSocket；改用长连接替代轮询
- 把 Connecter 做成业务网页
- `@` 用户-only 的纯 IM（无 Agent 则走 G7 或拒绝；本期不允许「只 @ 人、不调度 Agent」的第三条路径）
- 动态 `POST /v1/register`、跨 env 在同一面板里切 prod/canary（env 仍来自桌宠配置）

## 3. 拓扑

```text
WorkPet 展开面板 ──pet token──► Connecter /v1/groups* 和 /v1/chat
                                      │
                                      │ 门面账号 login
                                      ▼
                               WorkPanel /api/groups
                                         /api/groups/{id}
                                         /api/groups/{id}/messages
                                         /api/presence
                                         POST /api/messages  (@目标 Agent)
```

Connecter 仍只做调度/中继。群数据不在 SQLite 做第二份历史；代理 WP 实时结果。`agent_instances` 继续用于默认值班 Agent 解析；**不再**作为「能否进入该群」的门槛。

## 4. Connecter API

鉴权：与现有 pet 端点相同（`Authorization: Bearer` pet token）。ops token 访问 `/v1/groups*` → **403**（与 `/v1/instances` 一致）。`env` 缺省 canary；`allowProdFromPet=false` 时 `env=prod` → **403** `PROD_FORBIDDEN`。

控制台只读 GET **不计入**现有 60 req/min chat 限额，另计 `console` 限额 **120 req/min/pet**，避免 2s 轮询堵住发送。

### 4.1 `GET /v1/groups?env=`

代理 `GET /api/groups`。

**200**

```json
{
  "env": "canary",
  "groups": [
    { "id": "<uuid>", "name": "灰度测试", "unreadCount": 0 }
  ]
}
```

WP 若无 `unreadCount` 则省略或给 `0`。失败 → **502** `{ "error": "…", "code": "WP_GROUPS_FAILED" }`。

### 4.2 `GET /v1/groups/:id?env=`

代理 `GET /api/groups/{id}` + `GET /api/presence`。

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

`coordinatorAgent` 与无 `@` 发送的默认目标相同（§4.4）。

`online`：`kind=user` 时 `id∈onlineUserIds`（若 presence 用的是 userId 而非 memberId，按 WP 字段对齐，在实现时与 `/api/groups/{id}` 成员记录做一次映射，**禁止猜字段**）；`kind=agent` 时 `online === isActive`。presence 失败则用户 `online` 全为 `false`，仍返回成员列表。

群不存在或不在门面可见范围 → **404**。

### 4.3 `GET /v1/groups/:id/messages?env=&limit=`

代理 `GET /api/groups/{id}/messages`。`limit` 默认 50，最大 100。WP 已有的分页/游标查询参数**原样转发**，不在 Connecter 自造历史库。

每条消息在 WP 字段之外增加：

| 字段 | 说明 |
|------|------|
| `petDisplayName` | 若正文含本规格戳记（§5.2）则为戳记中的名字，否则 `null` |
| `contentDisplay` | 去掉戳记行后的正文，供桌宠渲染 |

### 4.4 `POST /v1/chat`（扩展，兼容旧客户端）

原字段保留。变化：

| 字段 | 本期 |
|------|------|
| `group` / `groupId` | 可以是门面可见的任意群，**不要求**已有 `agent_instances` 行 |
| `agent` / `agentName` | 若请求体显式给出则用之；否则由 Connecter 从 `prompt` 解析 `@`（§5.1） |
| `petName` | 可选，最长 32 字，用于戳记；缺省 `WorkPet` |

无 `@` 且无 `agent`：用该群在 `relay.json` 绑定的 `agentName`，若该群未绑定则用该 env 的 `defaults.coordinatorAgentName`，再否则用群内第一个 `kind=agent && isActive` 的成员。三者都没有 → **400** `NO_COORDINATOR`。

`@` 对不上任何成员 `displayName` → **400** `UNKNOWN_MENTION`，不转发 WP。

成功响应形状与现契约相同，另加 `mentionedAgent`（实际 mention 的 Agent 显示名）。

## 5. `@` 与本宠戳记

### 5.1 解析

1. 在 `prompt` 中找 `@` 后的显示名，按群成员 `displayName` **最长匹配**。  
2. 匹配到的必须是 `kind=agent`；匹配到用户或未匹配 → **400** `UNKNOWN_MENTION`。  
3. 多个 `@Agent`：第一个为投递目标，其余写入 `mentionMemberIds`（若 WP 支持多人 mention）。  
4. 转发 WP 的 `content` 形如：

```text
@{agentDisplayName}
【WorkPet:{petName}】
{用户原文，可去掉已匹配的前导 @Agent 以免重复}
```

`mentionMemberIds` = 目标 Agent 的 member id。

### 5.2 桌宠如何认出「自己的话」

戳记单独一行：`【WorkPet:{petName}】`。代理消息时解析该行填 `petDisplayName`。WorkPet 若 `petDisplayName` 非空，作者栏显示该名并渲染 `contentDisplay`；否则显示 WP 的 `senderDisplayName`。

乐观发送：本地先插入一条作者=`petName` 的气泡，轮询到带同一戳记的 WP 消息后去重。

## 6. WorkPet UI

收起态：不变（Live2D + 聊一聊）。

展开态（约 440×680）：

- 顶栏：当前群名下拉（`GET /v1/groups`），徽章仍表示中继/WP 是否可用  
- 成员条：`displayName` + 在线点；点击 Agent 把 `@显示名 ` 插入输入框  
- 消息列表：`GET /v1/groups/:id/messages`；本宠用 `petDisplayName`  
- 输入：`@` 对当前群 Agent 做前缀补全；发送走扩展后的 `POST /v1/chat`  
- 切群：重置消息列表与成员，停止上一群轮询  

轮询：面板打开时消息 2s（沿用 `pollIntervalMs`），成员/在线 10s。面板关闭则停。

配置：继续用 `~/.workpet/config.json` 的 `petName`、`env`、`connecterBaseUrl`、`token`。上次选中的 `groupId` 可写入 `localStorage`，启动展开时若仍在群列表中则恢复。

## 7. 失败与验收

| 情况 | 行为 |
|------|------|
| 无 token / 中继挂 | 徽章失败；Live2D 可用；发送提示先配连接 |
| `GET /v1/groups` 失败 | 下拉显示错误，不把桌宠打成 Live2D fallback |
| 单群消息/成员失败 | 该区域错误文案，其它群仍可切 |
| `UNKNOWN_MENTION` | 不发送；气泡「找不到 @某某」 |
| `429` | 暂停该 pet 的控制台轮询并提示 |
| Live2D 失败 | 与本期无关，保持既有 SVG 降级 |

验收：

1. 展开后列出多于一个门面可见群并可切换  
2. 成员有在线点；点 Agent 或输入匹配的 `@` 后，WP 侧该 Agent 被 mention  
3. 最近群消息能出现；本宠侧作者为 `petName`，不是门面用户名  
4. 无 `@` 时仍打值班 Agent  
5. 未知 `@` 不发送  
6. `GET /v1/messages` ack 契约与既有门禁不回归  
7. `docs/NEXT-DEV-PATH.md` 记载 WP Pet 身份诉求（§8）

## 8. 下一步规划（给 WorkPanel 的诉求，本期不实现）

**问题：** 群里真实发送者仍是门面账号；桌宠只在自己的 UI 里把气泡标成「XXX的Pet」。两边身份不一致。

**诉求（WP）：**

1. 承认 **Pet 成员**（`kind=pet` 或等价）：可登录或由 Connecter 代登记，出现在 `GET /api/groups/{id}` 的 members 里。  
2. `POST /api/messages` 允许 `senderMemberId` 为该 Pet 成员（或提供 pet token 映射），群聊作者为「XXX的Pet」。  
3. 在线：Pet 心跳进入 `GET /api/presence`（或单独 pet presence）。  
4. Connecter 不再用群 owner 用户冒名发送。

**之后才做：** WorkPet 登录态（WP 或 Connecter 颁发的 pet 身份），替换 G4 门面代发。

跟踪项：`docs/NEXT-DEV-PATH.md` **P2.5**。

## 9. 实现落点（供计划，非本期编码）

| 层 | 路径 |
|----|------|
| WP 代理 | `src/workpanelClient.js`：列群、群状态、群消息、presence；chat 已有 `POST /api/messages` |
| 中继 | `src/relay/handlers.js` + `server.js` 路由；`apps/workpet/ui/connecterApi.js` |
| 桌宠 | `apps/workpet/ui/main.js`、`style.css`、`index.html` |
| 契约文档 | 实现时更新 `docs/api-relay.md` |
| 测试 | 中继：mock WP 的 groups/messages/presence + chat mention；桌宠：`@` 解析与戳记纯函数测试 |

## 10. 明确不做（直到改规范）

与 `NEXT-DEV-PATH.md` §4 相同，外加：本期不在 WorkPet 做 WP 登录；不把群历史镜像进 Connecter SQLite。
