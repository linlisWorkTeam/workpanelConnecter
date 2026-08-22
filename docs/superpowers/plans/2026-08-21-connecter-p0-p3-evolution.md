# Connecter P0–P3 Evolution Implementation Plan

> 文档状态：已完成的实施计划和验收来源。checkbox 保留执行历史；当前结果见 `docs/P0-P3-IMPLEMENTATION-STATUS.md`。

> **执行方式：** 按阶段、按 Task 顺序实施；每个 Task 单独 PR/提交并通过该 Task 门禁后再进入下一项。执行时不要自动 commit，除非用户当场要求。

**Goal:** 将现有“站点内 WorkPet/WorkPanel/Runner 中继 + Host peer 注册骨架”演进为可靠、可扩展、可审计的多站 Connecter 网络，最终打通 `Connecter A → Connecter Host → Connecter B` 的真实消息闭环。

**Architecture:** 本站流量继续由本站 Connecter 处理，Host 不成为本站聊天的强制依赖。P0 先建立可靠任务租约、数据库迁移和应用服务边界；P1 建立带站点命名空间的主体目录、能力注册、凭证生命周期和路由器；P2 以 durable inbox/outbox + 站点出站长轮询实现中心 Host 联邦；P3 增加设备身份、ACL、观测、滚动升级和灾备。WorkPanel 始终是群聊正文事实源，Connecter/Host 只持久化路由信封、投递状态和必要审计。

**Current baseline:** `main@e5b51eb9f89f9bcbb19480d58dc2de230d7e7591`

**Tech Stack:** Node.js ES modules、`node:http`、`node:sqlite`/SQLite WAL、JSON/REST、现有 node 脚本门禁。

## Global Constraints

- UI 只叫 **WorkPet**；每站一台 **Connecter**；全网一台 **Connecter Host**。
- WorkPet 只连本站 Connecter；Runner 只向本站 Connecter 出站；Host 不接 WorkPet、不直连 WorkPanel、不执行 Agent。
- 本站消息不绕行 Host；只有跨站消息走 `Connecter A → Host → Connecter B`。
- WorkPanel 保持群、成员和聊天正文的事实源；不得在 Host 复制一套可写群聊历史。
- 协议变更优先向后兼容；旧 Runner API 在 P0/P1 期间必须继续工作。
- 不以 `agentName`、`groupName`、用户名等显示字段作为全局身份；跨站身份必须使用稳定 ID。
- 所有队列 claim、ack、result、forward、delivery 操作必须幂等。
- 每一阶段必须包含升级测试、故障恢复测试和现有回归门禁；进程健康不等于端到端验收。
- `config/relay.json`、SQLite 数据、真实 token/证书继续保持本地和 gitignored。

## Target State Machine

### Runner task

```text
queued → leased → acknowledged → running → completed|failed|cancelled
   ▲         │
   └─────────┴── lease expired + attempts remaining

leased|acknowledged|running → dead（超过 maxAttempts 或不可重试错误）
```

### Federation delivery

```text
accepted → queued_for_site → leased_by_site → delivered
    │              │               │
    └──────────────┴───────────────┴→ failed|expired|dead
```

## Cross-phase Data Ownership

| 数据 | 事实源 | Site Connecter | Host |
|---|---|---|---|
| User/Agent/群正文 | WorkPanel | 读取/短期投影 | 不保存正文历史 |
| Runner 在线与能力 | Site Connecter | 权威 | 可路由投影 |
| Site 在线状态 | Host | 本地连接状态 | 权威 |
| Runner task | Site Connecter | 权威、durable lease | 不保存 |
| 跨站 envelope | Origin/Target + Host | inbox/outbox | durable transit |
| 投递审计 | 各参与节点 | 本地 hop | 全局投递摘要 |

## Required Gates Throughout

```text
npm test
npm run test:relay-unit
npm run test:relay
npm run test:e2e-resume
npm run test:runner-handler
npm run test:runner
npm run test:host-peers
```

依赖真实 WorkPanel 的 `test:e2-canary` 单独作为发布前门禁，不作为纯单元 PR 的硬依赖。

---

# P0 — 站点内可靠性与架构边界

**Exit criteria:** Runner 领取任务后无论正常完成、进程崩溃、超时、重复回调或 Connecter 重启，都不会永久卡死或重复提交终态；旧数据库可版本化升级；HTTP handler 不再直接编排核心任务状态机。

## Task P0.1：版本化数据库迁移

**Files:**

- Create: `src/relay/migrations.js`
- Create: `src/relay/migrations/001-baseline.sql`
- Create: `src/relay/migrations/002-runner-task-lease.sql`
- Modify: `src/relay/db.js`
- Create: `scripts/migrations-unit.js`
- Modify: `package.json`
- Modify: `docs/relay-operations.md`（不存在则创建）

**Work:**

- [ ] 增加 `schema_migrations(version, name, checksum, applied_at)`。
- [ ] `openDb()` 在一个事务中按版本执行 pending migration，校验已应用 migration checksum 不漂移。
- [ ] 现有无版本数据库识别为 baseline，不重复建表、不丢数据。
- [ ] 升级前执行 SQLite backup；失败回滚 migration，并保留原 DB。
- [ ] 禁止启动时继续依赖一份不断膨胀的 `schema.sql` 隐式升级；`schema.sql` 仅作为全新数据库快照。

**Gate:**

- [ ] 空 DB 从 0 升到 latest。
- [ ] 现有 schema fixture 升级后消息、sessions、runners 均保留。
- [ ] 重复启动无副作用。
- [ ] checksum 被修改时启动失败并给出明确错误。

## Task P0.2：Runner task lease 与原子 claim

**Files:**

- Modify: `src/relay/schema.sql`
- Modify: `src/relay/migrations/002-runner-task-lease.sql`
- Modify: `src/relay/runners.js`
- Modify: `config/relay.schema.json`
- Modify: `docs/protocol/runners.md`
- Create: `scripts/runner-lease-unit.js`

**Schema:**

```text
runner_tasks:
  lease_owner TEXT
  lease_token_hash TEXT
  lease_until TEXT
  attempt INTEGER NOT NULL DEFAULT 0
  max_attempts INTEGER NOT NULL DEFAULT 3
  available_at TEXT
  acknowledged_at TEXT
  last_error TEXT
```

**Work:**

- [ ] poll 在单个事务中回收过期 lease，再 claim 最早可用任务。
- [ ] claim 返回不可预测的 `leaseToken`，数据库只保存 hash。
- [ ] `queued` 和 lease 已过期的非终态任务可被领取；一个 Runner 同时最多 `maxConcurrency` 条。
- [ ] 旧 `dispatched` 行升级时设置有限 lease，防止永久卡死。
- [ ] `runnerTaskLeaseSec`、`runnerTaskMaxAttempts` 写入 schema/config 文档并有安全默认值。

**Gate:**

- [ ] 两个并发 poll 只能有一个拿到同一 task。
- [ ] lease 未过期不可重复领取；过期后 attempt 增加并重新领取。
- [ ] 超过 maxAttempts 进入 `dead`，后续任务仍可继续。
- [ ] Connecter 重启后能回收过期 lease。

## Task P0.3：ack、续租、result fencing 与幂等终态

**Files:**

- Modify: `src/relay/server.js`
- Modify: `src/relay/handlers.js`
- Modify: `src/relay/runners.js`
- Modify: `docs/protocol/runners.md`
- Modify: `scripts/wp-runner.js`
- Modify: `scripts/relay-runner-smoke.js`
- Create: `scripts/runner-fencing-unit.js`

**API:**

- `POST /v1/agents/tasks/ack { taskId, leaseToken }`
- `POST /v1/agents/tasks/renew { taskId, leaseToken }`
- `POST /v1/agents/tasks/result { taskId, leaseToken, resultId, status, content }`

**Work:**

- [ ] ack、renew、result 都校验 task owner 与当前 lease token。
- [ ] result 使用 `(taskId, resultId)` 幂等；完全相同的重复结果返回 200。
- [ ] 旧 lease 的迟到结果返回 409 `STALE_LEASE`，不得覆盖新执行者结果。
- [ ] 终态写 task、up message、down message、run event 必须在同一事务完成。
- [ ] 旧 Runner 暂时允许无 leaseToken 模式，但仅在 `runnerProtocolCompatibility=v1` 显式开启；P1 结束后默认关闭。

**Gate:**

- [ ] ack 前崩溃、ack 后崩溃、运行中断连、重复终态、迟到旧结果均有自动化测试。
- [ ] `npm run test:runner` 继续覆盖完整自然语言结果回显。

## Task P0.4：恢复、死信与运维接口

**Files:**

- Create: `src/relay/services/taskQueueService.js`
- Create: `src/relay/services/deadLetterService.js`
- Modify: `src/relay/server.js`
- Modify: `src/relay/handlers.js`
- Create: `scripts/runner-recovery-e2e.js`
- Modify: `package.json`

**API:**

- `GET /v1/ops/tasks?status=&runnerId=`（ops）
- `POST /v1/ops/tasks/:id/requeue`（ops，记录审计原因）
- `POST /v1/ops/tasks/:id/cancel`（ops）

**Work:**

- [ ] 启动恢复扫描不再只处理 `messages.accepted`，同时回收 task lease。
- [ ] dead-letter 必须保留 attempt、最后错误和关联 message/run。
- [ ] 人工重投生成新 lease generation，旧执行结果无法生效。
- [ ] `runner-recovery-e2e` 真正杀掉 Runner/Connecter 进程并验证恢复。

## Task P0.5：拆分应用服务与固定全局 ID 基础

**Files:**

- Create: `src/relay/services/identityService.js`
- Create: `src/relay/services/directoryService.js`
- Create: `src/relay/services/messageService.js`
- Create: `src/relay/services/dispatchService.js`
- Create: `src/relay/services/auditService.js`
- Modify: `src/relay/handlers.js`
- Modify: `src/relay/delivery.js`
- Create: `docs/protocol/identifiers.md`

**Work:**

- [ ] `server.js` 只负责 HTTP、认证、DTO；`handlers.js` 逐步降为 transport adapter。
- [ ] 定义 `siteId`、`subjectId`、`groupRef`、`runnerId`、`messageId` 格式和大小写规则。
- [ ] 跨站主键使用稳定 ID；显示名只用于 UI 与本地查找。
- [ ] 为后续 P1/P2 预留 `correlationId`、`causationId`、`traceId`，但不改变现有 WorkPet API 响应。

**P0 release gate:**

- [ ] 全部 Required Gates 通过。
- [ ] 新增 migration、lease/fencing、recovery 门禁通过。
- [ ] 对一份生产 DB 副本执行升级、回滚演练。
- [ ] 人工验收：Runner 取任务后强杀，TTL 后另一轮可重新领取并只产生一个有效终态。

---

# P1 — 全局主体目录、能力注册与策略路由

**Depends on:** P0 migration、稳定 ID、application service 边界。

**Exit criteria:** Connecter 能清楚回答“哪个站点的哪个主体属于哪个群、当前是否在线、具备什么能力、为什么被选中”，凭证可审批、轮换和吊销；旧精确绑定仍可作为兼容路由。

## Task P1.1：冻结 Directory 与 Runner Protocol v2

**Files:**

- Create: `docs/protocol/directory-v2.md`
- Modify: `docs/protocol/runners.md`
- Modify: `config/relay.schema.json`
- Create: `src/relay/contracts/directory.js`
- Create: `scripts/directory-contract-unit.js`

**Contracts:**

```text
Subject:  { subjectId, siteId, kind: user|agent|workpet|service, displayName }
Endpoint: { endpointId, subjectId, protocol, version, status, lastSeenAt }
Capability: { name, version, labels, limits }
Membership: { groupRef, subjectId, role, permissions, status }
Presence: { subjectId, state, observedAt, expiresAt, source }
```

- [ ] Runner register v2 增加 `protocolVersion`、`capabilities`、`maxConcurrency`、`labels`、`load`。
- [ ] 未知 capability 被保留但不自动授权；不允许客户端自报权限。
- [ ] v1/v2 DTO 使用显式解析器和错误码，拒绝超大/非法 payload。

## Task P1.2：Directory 持久化与投影

**Files:**

- Create: `src/relay/migrations/003-directory.sql`
- Create: `src/relay/directory.js`
- Modify: `src/relay/runners.js`
- Modify: `src/relay/groupConsole.js`
- Create: `scripts/directory-projection-unit.js`

**Tables:** `subjects`、`endpoints`、`capabilities`、`memberships`、`presence_observations`。

- [ ] 从现有 `runners`、`runner_bindings`、WP 群成员建立兼容投影；原表暂不删除。
- [ ] presence 带来源和 TTL，不把“进程 active”与“可被调度”混为一谈。
- [ ] 同名 Agent 在不同站点/群不会发生身份碰撞。
- [ ] Directory 查询支持按 groupRef、capability、siteId、online 过滤。

## Task P1.3：Enroll、审批与凭证生命周期

**Files:**

- Create: `src/relay/enrollment.js`
- Create: `src/relay/credentialStore.js`
- Create: `src/relay/migrations/004-enrollment.sql`
- Modify: `src/relay/server.js`
- Modify: `config/relay.schema.json`
- Create: `scripts/enrollment-unit.js`

**API:**

- `POST /v2/enrollments`：提交一次性 enrollment code 与设备公钥/元数据。
- `GET /v2/ops/enrollments`、`POST /v2/ops/enrollments/:id/approve|reject`。
- `POST /v2/credentials/rotate`、`POST /v2/ops/credentials/:id/revoke`。

- [ ] 现有 `relay.json runners[]` 保留为 bootstrap allowlist，不再作为长期 bearer 的唯一存储。
- [ ] 凭证只保存 hash/公钥、key id、范围、过期时间和吊销时间。
- [ ] 审批时绑定允许的 site/group/capability 范围，客户端自报不能扩大权限。

## Task P1.4：可解释的策略路由器

**Files:**

- Create: `src/relay/routeResolver.js`
- Create: `src/relay/policy.js`
- Modify: `src/relay/delivery.js`
- Modify: `src/relay/mentions.js`
- Create: `scripts/route-resolver-unit.js`

**Route order:**

1. 显式稳定 subject ID；
2. 当前群中名称唯一且被授权的 Agent；
3. 符合 required capabilities 的在线 endpoint；
4. 本站优先、健康/负载/优先级排序；
5. 无可用 endpoint 时按策略回落 WP Agent 或返回明确不可调度错误。

- [ ] 输出 `RouteDecision { target, reason, considered[], policyVersion }` 并写审计。
- [ ] 群成员资格是硬约束；在线状态、负载是选择因素，不能绕过 ACL。
- [ ] `maxConcurrency` 接入 P0 lease claim，不再硬编码每 Runner 仅一条。

## Task P1.5：Directory API 与兼容层

**Files:**

- Modify: `src/relay/server.js`
- Create: `src/relay/handlers/directoryHandlers.js`
- Modify: `docs/api-relay.md`
- Create: `scripts/directory-api-unit.js`

**API:**

- `GET /v2/directory/subjects?groupRef=&kind=&online=`
- `GET /v2/directory/endpoints?capability=&siteId=`
- `GET /v2/routes/explain?...`（ops only）

- [ ] 现有 `/v1/agents` 与 `/v1/members` 由新服务投影生成，保持响应兼容。
- [ ] 禁止向普通 WorkPet 泄露 endpoint 地址、凭证状态和内部负载。

**P1 release gate:**

- [ ] v1 Runner 与 v2 Runner 同时注册、领取和回结果。
- [ ] 同名跨站 Agent 不冲突；被吊销 Runner 立即无法 heartbeat/poll/result。
- [ ] 路由选择包含可解释原因，权限测试覆盖跨群、跨站和 capability 欺骗。

---

# P2 — Connecter Host 跨站联邦数据面

**Depends on:** P0 durable lease/migration；P1 global IDs、directory、policy、credential scopes。

**Exit criteria:** 两台 Site Connecter 与一台 Host 能完成真实双向消息/结果闭环；任一进程重启、短时断网、重复提交和乱序回执都不丢消息、不产生两个有效终态；本站消息在 Host 不可用时仍正常。

## Task P2.1：冻结 Federation Envelope v1

**Files:**

- Create: `docs/protocol/federation-v1.md`
- Create: `src/relay/contracts/federation.js`
- Create: `scripts/federation-contract-unit.js`

**Envelope:**

```json
{
  "protocol": "workpanel.connecter.federation/v1",
  "messageId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid|null",
  "originSite": "site-a",
  "targetSite": "site-b",
  "groupRef": "wp:<authority>:<group-uuid>",
  "fromSubject": "subject-uuid",
  "toSubject": "subject-uuid",
  "kind": "chat.command|run.event|delivery.receipt",
  "payload": {},
  "createdAt": "RFC3339",
  "expiresAt": "RFC3339",
  "hop": 0,
  "traceId": "uuid",
  "keyId": "...",
  "signature": "..."
}
```

- [ ] 限制 payload 大小、hop 上限和最大有效期；拒绝 origin/credential 不一致。
- [ ] 幂等键固定为 `(originSite, messageId)`。
- [ ] `delivery.receipt` 不递归产生 receipt。

## Task P2.2：Host durable inbox/outbox

**Files:**

- Create: `src/relay/migrations/005-federation-host.sql`
- Create: `src/relay/federationHost.js`
- Create: `src/relay/handlers/federationHostHandlers.js`
- Modify: `src/relay/server.js`
- Create: `scripts/federation-host-unit.js`

**Tables:** `federation_messages`、`federation_deliveries`、`federation_receipts`。

**Host API:**

- `POST /v1/federation/messages`：origin Site 接受跨站 envelope。
- `POST /v1/federation/pull?limit=`：target Site 长轮询领取待转发 envelope。
- `POST /v1/federation/ack`：target Site 确认已持久化到本地 inbox。
- `POST /v1/federation/result`：报告 delivered/failed/expired。

- [ ] 所有接口复用 peer 身份并校验 origin/target scope。
- [ ] Host 接受后先持久化再 202；重复 message 返回原 delivery 状态。
- [ ] pull 使用 lease；Site 未 ack 时超时可重投，不能永久丢失。
- [ ] Host 只保存必要 payload/引用和投递状态，按 retention 清理终态记录。

## Task P2.3：Site federation client 与本地 inbox/outbox

**Files:**

- Create: `src/relay/migrations/006-federation-site.sql`
- Create: `src/relay/federationClient.js`
- Create: `src/relay/services/federationService.js`
- Modify: `src/relay/hostJoin.js`
- Modify: `src/relay/server.js`
- Create: `scripts/federation-site-unit.js`

- [ ] Site 所有连接均主动出站；Host 不反向连接 NAT 后的 Site。
- [ ] origin Site：本地 outbox 事务落盘后异步发送 Host。
- [ ] target Site：从 Host pull 后先写本地 inbox，再 ack Host，再交给 dispatch service。
- [ ] inbox 消费失败与 Host ack 分离；本地可重试，不要求 Host 重复正文。
- [ ] `hostJoinState` 分开报告 control link、federation pull、outbox backlog，不能只给一个 linked 布尔值。

## Task P2.4：跨站目录同步与路由接入

**Files:**

- Create: `src/relay/migrations/007-host-directory.sql`
- Modify: `src/relay/federationHost.js`
- Modify: `src/relay/directory.js`
- Modify: `src/relay/routeResolver.js`
- Create: `scripts/federation-routing-unit.js`

- [ ] Site 定期向 Host 发布授权后的 route advertisement，不上传密钥和不必要用户信息。
- [ ] Host 生成全局路由投影：`groupRef/subjectId → siteId`，带 TTL 与版本。
- [ ] origin Site 只在本地无目标且策略允许跨站时选择 Host 路由。
- [ ] 目录过期、目标 Site 离线、路由冲突返回稳定错误码，并可选择排队或快速失败策略。

## Task P2.5：跨站结果回流与 WorkPanel 回写

**Files:**

- Modify: `src/relay/services/dispatchService.js`
- Modify: `src/relay/services/federationService.js`
- Modify: `src/relay/runners.js`
- Modify: `src/workpanelClient.js`
- Create: `scripts/federation-result-unit.js`

- [ ] target Runner/WP 的运行事件用相同 correlationId 反向发回 origin Site。
- [ ] origin Site 将结果写入 `/v1/messages` 和 run 投影；必要时 best-effort 回写 origin WorkPanel 群。
- [ ] 回写失败不使已完成的远端执行回滚；失败进入独立 delivery 状态和审计。

## Task P2.6：三进程联邦 E2E 与故障矩阵

**Files:**

- Create: `scripts/federation-e2e.js`
- Create: `scripts/federation-chaos-e2e.js`
- Modify: `package.json`
- Create: `docs/runbooks/federation-local-lab.md`

**Topology:** Site A Connecter + Host + Site B Connecter + mock/real WP/Runner。

- [ ] A User → A Connecter → Host → B Connecter → B Runner → 原路结果回 A。
- [ ] 覆盖重复 POST、重复 pull、ack 丢失、B 离线后恢复、Host 重启、A 重启、结果乱序、TTL 过期。
- [ ] 证明同一 message 只有一个有效执行终态。
- [ ] 关闭 Host 后，A/B 各自本站 WorkPet→WP/Runner 路径仍成功。
- [ ] 发布前再用三台真实服务器完成一次同等验收并保存证据。

**P2 release gate:**

- [ ] `npm run test:federation` 与 `npm run test:federation-chaos` 通过。
- [ ] 两站真实部署闭环通过，不能只以 health/peer linked 作为完成证据。
- [ ] backlog、dead letter 和端到端 trace 可查询。

---

# P3 — 生产安全、观测与运维

**Depends on:** P2 协议稳定；可与 P2 后半段局部并行开发，但不能在 P2 验收前宣称生产可用。

**Exit criteria:** 每个 Site/Runner 都有可轮换、可吊销、最小权限的设备身份；跨站请求受策略约束并可完整追踪；支持兼容滚动升级、容量保护、备份恢复和安全事件处置。

## Task P3.1：设备身份、签名与密钥轮换

**Files:**

- Create: `src/relay/deviceIdentity.js`
- Create: `src/relay/envelopeSignature.js`
- Modify: `src/relay/credentialStore.js`
- Modify: `src/relay/authPet.js`
- Modify: `src/relay/federationClient.js`
- Modify: `src/relay/federationHost.js`
- Create: `scripts/device-identity-unit.js`

- [ ] bootstrap token 只用于首次 enrollment，随后签发带 key id、scope、过期时间的设备凭证。
- [ ] Connecter↔Host 使用 TLS；生产建议 mTLS。federation envelope 另外签名，支持跨队列验证来源。
- [ ] 支持 active/next 两把 key 的无中断轮换窗口和即时 revoke。
- [ ] 私钥进入 OS secret store 或受限文件，不写普通 relay JSON/SQLite 明文。
- [ ] 防重放：签名覆盖 messageId、origin、target、时间和 payload digest。

## Task P3.2：统一 ACL/Policy

**Files:**

- Modify: `src/relay/policy.js`
- Create: `src/relay/migrations/008-policies.sql`
- Create: `src/relay/handlers/policyHandlers.js`
- Create: `scripts/policy-matrix-unit.js`

**Policy dimensions:** site、subject、group、capability、operation、direction、data classification。

- [ ] 默认拒绝跨站；必须显式授权 origin site + target group/subject + operation。
- [ ] Runner 自报 capability 不等于授权 capability。
- [ ] 所有拒绝写安全审计，但响应不泄露目标是否存在。
- [ ] 策略带版本；RouteDecision 和 federation delivery 记录所用版本。

## Task P3.3：端到端观测与审计

**Files:**

- Create: `src/relay/telemetry.js`
- Create: `src/relay/auditLog.js`
- Modify: `src/relay/server.js`
- Modify: `src/relay/services/*`
- Create: `docs/observability.md`
- Create: `scripts/trace-e2e.js`

- [ ] JSON 结构化日志统一 `traceId/correlationId/messageId/siteId/subjectId/taskId`。
- [ ] 指标至少包含在线 Site/Runner、queue depth、lease expiry、投递延迟、重试、死信、ACL deny、WP write-back failure。
- [ ] 提供 `/v1/ops/health/detail` 和 `/v1/ops/traces/:traceId`，严格 ops 权限。
- [ ] 审计日志 append-only，记录凭证、策略、人工重投/取消和跨站 hop。
- [ ] 对 payload/凭证/用户隐私字段做默认脱敏。

## Task P3.4：容量、限流与数据生命周期

**Files:**

- Create: `src/relay/quotas.js`
- Modify: `config/relay.schema.json`
- Modify: `src/relay/federationHost.js`
- Create: `scripts/quota-unit.js`

- [ ] 限制每 Site 的请求率、并发 pull、inflight、outbox bytes 和 dead-letter 数。
- [ ] payload 大小、消息 TTL、终态 retention 和审计 retention 可配置且有安全上限。
- [ ] 超限使用 backpressure/429，不允许拖垮其他 Site。
- [ ] 磁盘逼近阈值时停止接受新跨站消息，但本站链路保持可诊断。

## Task P3.5：兼容升级、备份恢复与灾备演练

**Files:**

- Create: `docs/runbooks/rolling-upgrade.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/security-incident.md`
- Create: `scripts/compat-matrix.js`
- Create: `scripts/backup-restore-e2e.js`
- Modify: `package.json`

- [ ] 明确当前与前一协议版本兼容矩阵；未知未来字段容忍，未知重大版本拒绝。
- [ ] Site 与 Host 支持先后任意顺序的滚动升级。
- [ ] SQLite online backup、恢复和 migration 重放有自动化门禁。
- [ ] 演练 Host 数据丢失：本站不受影响；跨站未完成消息按 runbook 对账/重投。
- [ ] 演练凭证泄露：revoke、轮换、审计检索和受影响 delivery 清单可完成。

## Task P3.6：生产发布门禁

- [ ] Required Gates、P0/P1/P2/P3 新增门禁全部通过。
- [ ] 安全评审：认证、ACL、SSRF、注入、重放、secret storage、日志脱敏。
- [ ] 72 小时 soak：队列无永久 stuck、无不断增长的 terminal 数据、无重复有效终态。
- [ ] 故障注入：Runner/Site/Host/WP 分别重启与断网。
- [ ] 真实多站验收：不同服务器 User 与 Agent 在同一业务群场景完成双向消息与结果回流。
- [ ] 监控、告警、on-call runbook 和回滚阈值确认后才能标记生产可用。

---

## Delivery Order and PR Boundaries

| 顺序 | PR/工作包 | 依赖 | 可独立发布 |
|---|---|---|---|
| 1 | P0.1 migrations | 无 | 是 |
| 2 | P0.2 lease claim | P0.1 | 是，兼容模式 |
| 3 | P0.3 ack/fencing | P0.2 | 是，v1 兼容 |
| 4 | P0.4 recovery/ops | P0.3 | 是 |
| 5 | P0.5 services/IDs | P0.1–P0.4 | 是 |
| 6 | P1.1–P1.2 contracts/directory | P0.5 | 是，影子投影 |
| 7 | P1.3 enrollment | P1.2 | 是 |
| 8 | P1.4–P1.5 routing/API | P1.1–P1.3 | 是，feature flag |
| 9 | P2.1 envelope | P1 完成 | 文档/契约 |
| 10 | P2.2–P2.3 Host/Site queues | P2.1 | 实验环境 |
| 11 | P2.4–P2.5 routing/results | P2.2–P2.3 | feature flag |
| 12 | P2.6 federation E2E | P2.4–P2.5 | 灰度后发布 |
| 13 | P3.1–P3.4 security/ops | P2 协议稳定 | 分项发布 |
| 14 | P3.5–P3.6 production gate | P3 前项 | 生产发布 |

## Feature Flags and Rollback

- `runnerLeaseV2Enabled`：P0 lease/ack 路径；关闭时仅允许明确的 v1 兼容 Runner。
- `directoryV2Shadow`：P1 先只写投影并比较旧/新路由决定，不影响真实投递。
- `directoryV2RoutingEnabled`：按群/站点逐步打开。
- `federationEnabled`：全局总闸；关闭后本站功能必须保持。
- `federationAllowedSites` / `federationAllowedGroups`：P2 灰度范围。
- 回滚不得降级已经写入的新 DB schema；旧代码必须在兼容窗口内能读取新增 nullable/default 字段。

## Definition of Done

P0–P3 只有在以下全部成立时才算完成：

1. 两个不同站点的 User/Agent 能通过各自 Connecter 接入同一协作场景。
2. 跨站消息真实经过 Host 并完成双向结果回流。
3. Host 不可用时本站聊天仍可用；恢复后未过期跨站消息继续投递。
4. Runner/Site/Host 任一点在关键时刻崩溃，都不会造成永久卡死或两个有效终态。
5. 每次路由、拒绝、重试和人工操作均可沿 traceId 解释。
6. 凭证可审批、轮换、吊销，跨群/跨站越权测试失败。
7. 升级、备份、恢复、容量和安全门禁均有可重复自动化证据。
