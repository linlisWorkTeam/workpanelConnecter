# 下一步开发路径（2026-08-07）

> 依据：仓库 HEAD `f7db1bc`；MVP Phase 0–4 已完成；规范 `workconnector-system-design.md` N1–N3 / D1–D16。  
> Owner：群内实现默认 **cs**（codex 仍搁置）；有明确 @ 时再改。

## 1. 当前基线（已落地，勿回退）

| 能力 | 状态 |
|------|------|
| Connecter HTTP 中继 + SQLite + 配置式 pets | ✅ |
| nginx `:80` → systemd `:9080` | ✅ |
| WorkPet 同仓（Tauri 壳 + JS SDK） | ✅ 服务器侧门禁绿；**桌面编包/冒烟在用户本机** |
| E2E E1–E8 | ✅ `docs/workpet-e2e-checklist.md` |
| 默认 canary / 禁默认 prod / 无 WP promote | ✅ 门禁覆盖 |

**产品形态**：Connecter = 中继 + CLI；GUI 仅 WorkPet；只做多 WP 调度协同，不做业务。

## 2. 建议下一程（按优先级）

### P0 — 收口可交付（本周可做，低风险）

| # | 项 | 说明 | 验收 / 状态 |
|---|-----|------|-------------|
| P0.1 | 用户本机 WorkPet 冒烟 | Win/macOS 构建连 `:80` | 能 chat+轮询 · **⏳ 用户侧** |
| P0.2 | API 对接短文 | 冻结 `/v1/*` | `docs/api-relay.md` · **✅ cs** |
| P0.3 | 运维手册 | 备份/token/systemd | `deploy/README.md` · **✅ cs** |

### P1 — Phase 5a：公网硬化（上桌宠公网前必做）

| # | 项 | 说明 | 验收 |
|---|-----|------|------|
| P1.1 | **T2 HTTPS** | 外层 `:443` → `:80`（证书）；中继仍听 9080 | curl https health |
| P1.2 | CORS 收紧 | 去掉 `*`，白名单 WorkPet origin | 负向测 |
| P1.3 | Token 轮换流程 | 文档 + 可选脚本；revoke 已有 | 手册可执行 |

### P2 — Phase 5b：多 WP 协同增强（对齐群公告主目标）

| # | 项 | 说明 | 验收 |
|---|-----|------|------|
| P2.1 | **WP → Connecter** 登记/回调 | 二期协议：WP 主动推送或 webhook；Connecter 写入 down messages | 设计评审 + 门禁 |
| P2.2 | 跨实例路由硬化 | A 群 pet → B 环境 WP；审计日志 | E2E 双 backend |
| P2.3 | 真实 Agent 全文回显 | 现 down 多为 delivery ack；需订阅 WP runs/消息 | 轮询可见回复摘要 |

### P3 — Phase 5c：体验与扩展（可并行、可砍）

| # | 项 |
|---|-----|
| P3.1 | WS `/v1/ws` 替代轮询（保留 since 兼容） |
| P3.2 | `POST /v1/register` 动态注册 + 审批 |
| P3.3 | 独立非 AI「协调 Agent」替换群 admin 门面 |
| P3.4 | WorkPet 皮肤/走动（F229 级）；CLI `/obs` `/restart-server` |

## 3. 推荐执行顺序

```text
P0.1 本机桌宠冒烟 ─┬─► P0.2 API 文档 ─► P0.3 运维
                   └─►（若要公网）P1.1 → P1.2 → P1.3
                            │
                            ▼
                     P2.1 WP 回连设计 → 实现 → 门禁
                            │
                            ▼
                     P2.3 全文回显 → P3 按需
```

**默认建议下一刀：用户完成本机 P0.1；服务端可开 P1.1（443）或进入 P2 设计（WP 回连）。P0.2/P0.3 已交付。**

**2026-08-10 战略更新**：内存瓶颈与「本机跑 Agent / Raft」讨论 → 演进答复见 **`docs/CONNECTER-EVOLUTION.md`（E1 外置注册优先）**。

## 4. 明确不做（直到改规范）

- Connecter 业务网页 / 业务 Agent  
- 默认打 prod、WP promote/freeze  
- Connecter 自建产/灰双槽  
- 新建 AT2AT  

## 5. 风险

| 风险 | 备注 |
|------|------|
| 文档曾滞后于代码 | 本次已对齐 ROADMAP / HANDOFF / NEXT |
| 下行仍是 ack 为主 | 用户体感「对话」需 P2.3 |
| OpenClaw vs cs Owner 表述曾冲突 | 以群 @ 为准；本文件默认 cs 跟进文档与规划 |
