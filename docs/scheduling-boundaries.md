# WorkPanelConnecter — 调度边界

> 状态：v1（对齐 A2A + 协调 Agent 愿景）  
> 日期：2026-08-04  
> 相关：`architecture.md` · `connecter-cli.md` · `ROADMAP.md`

## 1. 一句话定位

**Connecter** 支持不同 WorkPanel 之间的**协同调度**（跨服务/跨群组消息与任务派发）。  
形态为 **CLI 运维面 + HTTP 中继服务（生产占 :80）**；跨团队经中继路由到各 WP；**不做领域业务、不自带业务网页、不新建 AT2AT**。  
桌宠 GUI（WorkPet）为同仓独立应用，只调中继，不嵌入调度核。

## 2. In scope

| 能力 | 归属 |
|------|------|
| HTTP 中继（`:80` / 开发 `9080`） | Connecter relay：`/v1/health|envs|chat|runs|logs` |
| 按 env 路由到 WP canary/prod | Connecter 配置 `backends`（自身无产/灰双槽） |
| 跨 WP 调度发起与结果摘要 | Connecter CLI + 中继 |
| 在线服务/群组发现与刷新 | Connecter CLI |
| 调度记录查询 | Connecter CLI / 中继 `/v1/logs` |
| 对外群门面 / Agent 执行 | **WorkPanel**（中继调用其 API） |
| 猫猫球桌宠 UI | **WorkPet**（`apps/workpet`，二期起） |

## 3. Out of scope（禁止进入 Connecter 仓）

| 禁止项 | 归属 |
|--------|------|
| 网页端 / 业务 UI / 群聊产品功能 | WorkPanel 产品侧；桌宠 UI 仅 WorkPet |
| WorkPet 默认打生产环境 | 禁止；`allowProdFromPet=false` |
| 工作 Agent 人格、提示词、领域工具 | 各 WP 工作 Agent |
| 团队内部成员间调度实现 | 协调 Agent（WP 仓） |
| 新建 AT2AT 或私有跨团队协议 | 禁止；统一 A2A 扩展 |
| 直连工作 Agent 旁路协调层 | 禁止 |
| `/restart-server`、`/obs` 的完整实现 | 预制命令；延后阶段 |

**判定口诀**：若需求不经过「协调 Agent / 调度元数据」仍成立 → 属业务，不进 Connecter。

## 4. 部署与交互硬约束

1. Connecter **中继占 :80**（开发可用 `CONNECTER_RELAY_PORT=9080`）；自身不做产/灰双槽。  
2. MVP 默认路由 **canary**（如 WP `:8081`）；prod 需显式允许。  
3. 过渡期：中继以 WP 群 admin/值班 Agent 为门面；专用非 AI 协调 Agent 为后续。  
4. 协调/门面不可用 ⇒ **调度失败**（不旁路工作 Agent）。  
5. 触及 WP 生产/灰度部署时，不得由 Connecter 直接 promote/改写生产槽。  
4. 对外只暴露协调 Agent（标准 Agent Card，兼容原生 A2A）。

## 5. 与 WorkPanel 的边界示意

```
Connecter CLI ──(仅协调 Agent)──► WP-A 协调 Agent ──(原生)──► 工作 Agents
                     │ A2A
                     └──► WP-B 协调 Agent ──(原生)──► 工作 Agents
```

- Connecter：发现、发起、记录、运维向命令（部分预制）。  
- 协调 Agent：跨团队门面 + 对内调度。  
- 工作 Agent：业务执行；不对 Connecter 暴露。

## 6. 变更流程

1. 改边界须对照 `architecture.md` / `ROADMAP.md` 说明原因。  
2. 触及 WP 生产/灰度部署时，不得由 Connecter 直接改写生产槽数据；走 WP 侧运维约定。  
3. API/对接细节在 Roadmap **阶段 C** 冻结，本文件只锁边界。
