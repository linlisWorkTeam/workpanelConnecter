# Connecter 后续演进方向（管理员答复）

> 日期：2026-08-10 · 角色：cs（Connecter 侧）
> 背景：云主机内存仅够约 **2 个 Agent session**；希望参考 Raft「节点可分散部署」、本机跑 Agent；WorkPet/Connecter 现状是 **Team↔Team 中继**，尚未做 **Team 内跨机 Agent 直达**。
> 关联：`docs/workconnector-system-design.md` · `docs/NEXT-DEV-PATH.md` · `docs/bridge-deepseek-harness.md`
> 定位：**Connecter** = 每站点一台，接下辖 WorkPet、对本站 WorkPanel 投递。**Connecter Host** = 全网一台，只会合各 Connecter（不接桌宠、不直连 WP）。单站可合署为同一进程。DeepSeek Harness（dsh）只是 **一种** 未来 Runner。命名规格：`docs/superpowers/specs/2026-08-19-connecter-host-naming-design.md`。E2 插件：`docs/superpowers/specs/2026-08-19-e2-pluggable-runner-design.md`。

## 1. 问题重新表述

| 现象 | 根因（相对 Connecter） |
|------|------------------------|
| 再开 Agent 就 OOM | Agent **执行**仍堆在同一台阿里云 WP 上；Connecter 不执行 Agent，但当前路由目标几乎都指向这台机 |
| 「本地跑 Agent」未对接 | 缺 **跨机 Agent 注册表 + 可达地址 + 心跳**；不是缺桌宠 UI |
| Raft 提议 | 要的是「群内可登记部署在不同机器上的 Agent」，本质是 **成员资格 / 路由表**，不必第一步就上完整 Raft 日志复制 |

**Connecter 定位不变**：只做调度与中继，**不把 Agent 进程搬进 Connecter**，也不在小机器上再堆 session。

## 2. 目标架构（演进后）

```text
WorkPet A ──绑定──► Connecter A ──► 本站 WorkPanel A
                      │
                      ▼
                Connecter Host（唯一）
                      │
                      ▼
WorkPet B ──绑定──► Connecter B ──► 本站 WorkPanel B
```

- **本站**不经 Host。**跨站**才 `Connecter A → Host → Connecter B`（E3，未实现）。
- Runner 挂在 **Connecter** 上出站 pull。Host 不执行 Agent。
- 单站：Host 与该站 Connecter 可合署。

## 3. 对「Raft」的采用建议（务实拆分）

| 层次 | 建议 | 是否先做 |
|------|------|----------|
| **A. 分布式 Agent 注册** | Agent Runner 向 Connecter `register`：agentId、group、baseUrl、能力、token；心跳 + TTL 下线 | **是（下一阶段核心）** |
| **B. 群内路由** | `@某 Agent` / 调度策略：优先本机 → 同群已注册远端 → 回落云端 WP | **是（紧随 A）** |
| **C. 注册表高可用** | 多 Connecter 用 Raft/etcd 同步成员表 | **否（机器变多、中继成单点后再做）** |
| **D. 消息全序 Raft** | 群消息共识日志 | **否（WP 已有消息序；中继只保投递幂等）** |

一句话：**先做「类 Raft 成员视图」的注册与路由，再考虑 Raft 共识实现。**

## 3.1 参考 Raft 的理念（采用什么 / 不照搬什么）

群内「Agent 来自不同服务器、经 Connecter 通信」**模式上类似 Raft 集群**：多节点、有成员视图、有 Leader 角色感、故障要被发现。实现上 **借鉴理念，分阶段落地**，避免第一期嵌入完整 Raft 库。

| Raft 理念 | 映射到 Connecter | E1/E2 落地形态 |
|-----------|------------------|---------------|
| **集群成员** | 同群可有多个物理节点上的 Agent | `register` + `groupId` + `endpoint` |
| **心跳 / 任期感** | 节点存活才可被调度 | `heartbeat` + TTL；过期视为下线（类似 election timeout 发现失败） |
| **Leader** | 不强制选主跑模型；「协调入口」可固定为云 WP 薄门面或非 AI 协调器 | 调度决策在 Connecter；执行在 Follower 式 Runner |
| **日志复制** | **不**用 Raft log 复制群聊正文 | 群消息权威仍在 WP；Connecter 只做任务信封幂等投递 |
| **多数派提交** | 中继 HA 阶段再谈 | E4：成员表/配置共识可用 Raft/etcd |
| **单 Leader 写串行** | 同 `agentId` 任务串行，防双执行 | Connecter 侧按 agent 队列（逻辑串行，物理分散） |

**设计口号（给排期用）**：
*Membership & health like Raft；execution anywhere；conversation source-of-truth stays WorkPanel.*

## 4. 分阶段路线（建议拍板）

### 阶段 E1 — 减压：Agent 外置注册（优先） — **✅ 代码骨架（2026-08-19 `6b6b4f6`）**

**产出**

- 协议：`POST /v1/agents/register` · `POST /v1/agents/heartbeat` · `GET /v1/agents?group=`
- 表：扩展现有 `agent_instances`（增加 `endpoint`、`runtime=cloud|local|remote`、`last_seen`）
- Runner 最小规范：本机/旁路机跑 cursor-agent 等，只暴露「收任务 / 回状态」HTTP（或复用 WP runner 适配器）
- 云 WP：**限制并发 session**（配置级硬顶 2），溢出任务经 Connecter 改派到已注册 Runner

**验收**：同群 1 个云 Agent + 1 个本机 Runner；云内存不随「想法变多」线性涨。

### 阶段 E2 — Team 内跨机通信打通 — **✅ 可插拔 Runner + canary 实调用（2026-08-19）**

- 上行：WorkPet / WP → Connecter → **已注册 Runner 队列**（不再一律进云 session）
- 下行：`tasks/result` → **`/v1/messages` 全文**（P2.3）；WP 群回写 best-effort
- 策略：同 agent 串行 + 心跳 TTL；离线 runner 不入队
- **执行端可插拔**：本期第一插件 = **canary WP 实调用适配器**（禁止 echo mock 验收）；任意 Agent 只要走 `/v1/agents/*` 即可顶替；**不**在 Connecter 实现完整 ACP
- 规格：`docs/superpowers/specs/2026-08-19-e2-pluggable-runner-design.md`

### 阶段 E3 — Team↔Team 强化（现有能力加深）

- **Connecter A → Connecter Host → Connecter B**（联邦；Host 不接桌宠）
- WP→Connecter 回调、跨 env 审计（原 P2）
- 协调门面从「群 admin Agent」演进为 **非 AI 协调算法**（原架构债）
- （未做，**不影响 Runner 适配**）进程内按 `translatorLinks` 加载跨 WP 翻译器

### 阶段 E4 — Host HA + dsh 自举（远期）

- **Connecter Host** 双机 + 成员表共识（可选 Raft/etcd）；消息仍 SQLite/外置队列
- **dsh 作为一种 Runner** 接入同一 pull API，挂在各站 **Connecter** 上
- 仅当 Host 可用性成为瓶颈、或要上真实 Harness 时立项

## 5. 与现状 / NEXT 的衔接

| 已有 | 关系 |
|------|------|
| MVP Pet→Connecter→WP canary | 保留为「云端兜底路径」 |
| N1 配置式 pets | E1 起 **配置 + 动态注册** 并存（本机 Runner 动态，Pet 仍可配置） |
| P1 HTTPS/CORS | 本机 Runner 入网前必须先做完（否则家宽 Agent 不安全） |
| P2 WP 回连 / 全文回显 | 并入 E2，服务「跨机结果回桌宠/群」 |

**建议立即调整的优先级**：在原 P1 安全项之后，**插入 E1（外置注册）优先于** 纯体验向的 WS/动效（P3）。

## 6. 明确非目标（防跑偏）

- Connecter **不**内嵌再跑 cursor-agent 来「省 WP」——会把 OOM 挪到中继机
- **不**第一期上完整 Raft 库「为用而用」
- **不**替代 WorkPanel 群聊产品；只解决 **谁在哪台机器执行**
- **不**默认打开 prod；本机 Runner 默认只挂 canary 群

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 本机 Runner 在 NAT 后 | 先 VPN/反代/Connecter 主动拉（poll）任务，少依赖入站 |
| 注册表被伪造 | mTLS 或签发短期 runner token；群维度 ACL |
| 双通道乱序 | 同 agentId Connecter 侧串行队列；幂等 message id |
| 小机器仍扛 WP+中继 | 中继已较轻；E1 成功标志是 **WP session 数下降** |

## 8. 给决策人的一句话答复

> Connecter 下一步不是在小服务器上塞更多 Agent，而是做成 **跨机 Agent 注册与路由中枢**（理念对齐 Raft 的成员/心跳/故障发现，而非一上来复制 Raft 日志）。云 WP 只保留薄协调与少量 session；重 Agent 注册到本机/旁路机执行。完整 Raft 共识留到中继要 HA 时再上。

排期已按 **E1（骨架已落地）→ E2（当前设计）→ E3 → E4** 执行。E2 不拉 dsh、不做完整 ACP。

P0–P3 的可执行拆分、数据模型、API、测试门禁与上线/回滚条件见：
[`docs/superpowers/plans/2026-08-21-connecter-p0-p3-evolution.md`](./superpowers/plans/2026-08-21-connecter-p0-p3-evolution.md)。
