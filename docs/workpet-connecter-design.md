# WorkPet × Connecter 中继 — 设计稿

> 日期：2026-08-05  
> 状态：**cs 代决冻结**（操作者疲惫授权「你自己分析」；若次日有异议可改 D10–D12）  
> 相关：`architecture.md` · `scheduling-boundaries.md` · canary 联调记录

## 1. 已锁定决策

| # | 决策 |
|---|------|
| D1 | UI 形态：透明置顶的 Live2D 悬浮桌宠（WorkPet）；原「猫猫球」仅保留为加载失败时的静态降级 |
| D2 | MVP 对话：固定绑一个 WP 群的协调/值班 Agent |
| D3 | WorkPet 跑在用户自己的桌面（Win/macOS） |
| D4 | **不走 SSH 隧道**；桌宠 ↔ 服务器 **HTTPS** |
| D5 | 拓扑：`WorkPet → Connecter`，`WorkPanel → Connecter`；Connecter 为服务器上**单独端口**的稳定中继 |
| D6 | Connecter **自身不做生产/灰度双槽**；它是稳定中继，配置里登记多个 WP 后端（如 prod / canary）供路由 |
| D7 | Connecter 核仍「只做调度/中继、不做业务」；桌宠动画/IM 壳不进调度核 |
| D8 | **Connecter 占用服务器 :80**（群确认 2026-08-05）；角色仅为中继，使 WorkPet 与 WorkPanel 都能连上它 |
| D9 | WorkPet = 桌宠；不要求 Connecter 自带 GUI |
| D10 | **MVP 只做** `WorkPet → Connecter(:80) → WorkPanel`；`WorkPanel → Connecter` 登记/回调放二期 |
| D11 | **TLS**：MVP 中继对外先 **HTTP :80**（T1）；上桌面公网前再加 **外层 443→80**（T2）。不做进程内 TLS@80（T3） |
| D12 | WorkPet **同仓** `apps/workpet`（与中继契约一起演进） |
| D13 | **注册形态 = 配置式**（2026-08-06 root 确认）：`relay.json.pets` 登记 pet→多群→多 agent 实例，启动即生效；动态注册+审批二期（系统设计 N1） |
| D14 | **回显 = 轮询**（2026-08-06 root 确认）：`GET /v1/messages?since=` 游标续拉；WS 二期（系统设计 N2） |
| D15 | **持久化 = SQLite 落盘（MVP 即做）**（2026-08-06 root 确认）：messages/runs/agent_instances/sessions/delivery_log，WAL，重启可恢复（系统设计 N3） |
| D16 | **:80 落地方式 = nginx 反代共存（方案 B）**（2026-08-06 root 拍板）：nginx 保留 :80（homepage/WorkPanel 域名共存），`/v1/*` 反代 → Connecter 本机 **:9080**（systemd）；对外仍以 :80 可达，满足 D8「Connecter 占 80」意图；附带收益：免 root 绑 80/setcap；T2 时 443 反代同路径 |
| D17 | **WorkPet 渲染 = Live2D Cubism + WebGL**（2026-08-07）：渲染层运行在 Tauri WebView 中，与 Connecter SDK 解耦 |
| D18 | **状态驱动动作**：`idle/thinking/speaking/error` 由 UI 状态控制器映射到模型动作；动作缺失自动回退 Idle |
| D19 | **本地模型包 + 可配置入口**：模型从应用资源加载，`live2d.modelUrl` 可替换为已授权模型；不默认加载远程模型 |
| D20 | **许可边界**：Cubism Core、Framework 和模型分别遵守对应许可；发布主体在分发前完成 Live2D SDK 与模型授权检查 |
| D21 | **渐进降级**：WebGL、Core 或模型加载失败时显示静态 SVG，聊天主链路仍可用 |
| D22 | **窗口形态**：收起态默认 300×420（可调 75%～150%）、展开态 440×680；透明无边框置顶，独立拖拽柄，不再使用全窗口拖拽区 |

## 2. 目标拓扑

```text
                    ┌──────────────────────────────────────┐
                    │  Server                              │
                    │                                      │
  WorkPet (桌面) ──►│  Connecter 中继（稳定单实例 · :80）   │
                    │                                      │
  WorkPanel* ──────►│   路由表：env 名 → WP baseUrl         │
  (prod / canary …) │   例：prod → :8080，canary → :8081    │
                    └──────────────────────────────────────┘

* WorkPanel 仍按现有双槽部署；Connecter 只「认识」它们，不为自己再开一套 prod/canary 发布槽。
* 链路目标：双方都能连上 Connecter；Connecter 只做中继，不做业务。
```

### 2.1 角色

| 组件 | 位置 | 职责 |
|------|------|------|
| **WorkPet** | 用户桌面 | Live2D 角色、输入输出、本地配置（Connecter URL + 默认 env/群/Agent + 模型配置） |
| **Connecter 中继** | 服务器 | HTTPS API：鉴权、选 WP 环境、dispatch、查询 run/消息摘要、调度日志 |
| **WorkPanel** | 服务器（多实例） | 真正的群与 Agent 运行时；被 Connecter 调用，也可主动回调/上报到 Connecter（若需要） |

### 2.2 「区分生产/灰度」落在哪里

- **不在** Connecter 进程双开。  
- **在** Connecter 的**路由配置**，例如：

```json
{
  "listen": { "host": "0.0.0.0", "port": 80 },
  "backends": {
    "canary": { "baseUrl": "http://127.0.0.1:8081", "kind": "workpanel" },
    "prod":   { "baseUrl": "http://127.0.0.1:8080", "kind": "workpanel" }
  },
  "defaults": { "env": "canary", "group": "灰度测试", "coordinatorAgentName": "Cursor Agent" }
}
```

- WorkPet / 调用方请求带 `env=canary|prod`（或省略用 default）。  
- **硬约束建议**：WorkPet 默认只允许 `canary`；指向 `prod` 需显式配置 + 更强鉴权（避免桌宠误伤生产群）。

## 3. 与现有 Connecter MVP 的关系

| 现有 | 演进 |
|------|------|
| CLI + mock / 直连 WP | 保留 CLI 为运维面；**新增常驻 HTTPS 中继服务** |
| `kind=workpanel` 客户端 | 下沉为中继内部适配器（对 WP 仍走 login/health/messages） |
| `npm run test:canary` | 继续测「中继 → canary WP」；另增「WorkPet → 中继」契约测 |

产品边界更新表述：

- Connecter = **稳定中继 + 调度 CLI**（仍无业务网页）。  
- WorkPet = **独立桌面应用**（可同仓 `apps/workpet` 或另仓，推荐同仓 monorepo 子包）。

## 4. 端口与 TLS

**已锁定**：Connecter **占用 :80**，作为唯一对外中继入口（本机可再绑 loopback 健康检查，但对外声明就是 80）。

```text
WorkPet ──► http(s)://<server>:80/   ─┐
WorkPanel ─► http(s)://<server>:80/   ─┴► Connecter 中继
                                         ├─ route env=canary → 127.0.0.1:8081
                                         └─ route env=prod   → 127.0.0.1:8080
```

### 4.1 TLS 落点（已代决）

| 阶段 | 选择 | 理由 |
|------|------|------|
| MVP | **T1** Connecter 直服 **HTTP :80** | 占 80 已锁定；进程内 TLS@80 运维重；先打通中继 |
| 桌宠公网可用前 | **T2** 外层 **HTTPS :443 → :80** | 满足「桌宠走加密」而不改 Connecter 占 80 |
| 不做 | **T3** 进程 TLS@80 | 少见、证书/权限成本高 |

先前「桌宠 HTTPS」解释为：**公网路径由外层终止 TLS**；中继本身保持简单 HTTP 服务。

### 4.2 运维注意

- 绑 :80 通常需要 root 或 `cap_net_bind_service`。
- 若机上已有服务占 80，部署前必须迁走或改冲突方（**Connecter 优先占 80** 为产品决议）。
- Connecter **不为自己**再开 8080/8081 式产/灰槽。
- WorkPet 默认 `env=canary`；`prod` 需显式打开。

## 5. API 草图（中继对外，非最终）

前缀假设：`https://connecter.example/`

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/v1/health` | 中继探活 |
| GET | `/v1/envs` | 列出已配置 backend（不含密钥） |
| POST | `/v1/chat` | `{ env, group, agent?, prompt }` → 受理（messageId/runIds） |
| GET | `/v1/runs/{id}` | 查询运行摘要（回桌宠气泡） |
| GET | `/v1/logs?limit=` | 调度记录 |

鉴权：WorkPet / WorkPanel 使用 token 或 mTLS（MVP 可用签发长 token；生产必须可吊销）。

WorkPanel → Connecter：用于跨实例协同时的登记/回调（阶段后置）；MVP 可只做 **WorkPet → Connecter → WP**。

## 6. WorkPet Live2D 桌宠

1. 收起态显示完整 Live2D 角色；点击角色触发动作，点击聊天按钮展开聊天。  
2. 配置：Connecter base URL、token、默认 `env=canary`、群、Agent，以及可选 Live2D 模型路径/缩放/位置。  
3. 发送走 `POST /v1/chat`；先显示「已受理」；轮询 run/消息做简易回显。  
4. `idle/thinking/speaking/error` 驱动模型动作与 UI 状态；模型不含对应动作时回退 Idle。  
5. WebGL、Cubism Core 或模型资源失败时自动显示静态 SVG，不阻断聊天。  

平台：Win/macOS；壳固定为 **Tauri 2**。详细设计与验收见 `workpet-live2d-design.md`。

## 7. 明确不做（本期）

- Connecter 生产/灰度双进程、双端口自发布槽  
- SSH 隧道作为正式链路  
- WorkPet 直连 WorkPanel（绕过中继）  
- 桌宠默认打生产群  
- 把业务 IM/群管理做进 Connecter  

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 中继成为单点 | health + 简单重启；配置热更可后置 |
| 误路由到 prod | 默认 canary；prod 需显式开关 + 审计日志 |
| 暴露面 | 仅 HTTPS、鉴权、限流；不把 WP 管理端口裸奔到公网 |
| 与「纯 CLI」叙事变化 | 文档改为「CLI + 中继服务」；GUI 只在 WorkPet |
| Agent 异步 | 受理≠完成；需 runs 回读协议 |
| Live2D 资源许可混淆 | Core、Framework、样例/自有模型分别记录来源和许可；发布前由发布主体复核 |
| WebView/GPU 差异 | WebGL 能力检测 + SVG 降级；在 Windows WebView2 与 macOS WebKit 分别验收 |
| 模型动作命名不一致 | 语义状态到动作组的配置映射；缺失时回退 Idle |

## 9. 结论与现状（2026-08-07）

D10–D16 / N1–N3 已落地为运行中的 MVP（Phase 0–4）。  

**下一步**不在本文重复展开 → 统一见 **`docs/NEXT-DEV-PATH.md`**（P0 收口 → P1 公网硬化 → P2 多 WP 回连/全文回显 → P3 体验扩展）。