# HANDOFF · Connecter 实现交接

> 工作目录：`/AI/WorkPanelConnecter`  
> 更新：2026-08-06

## 当前 Owner

| 角色 | 状态 |
|------|------|
| **cs** | **实现中**（codex 搁置）；Phase 0–1 已完成 |
| **codex** | **搁置** — 工具调用通道故障（三次 turn 零执行）；恢复条件：至少一次真实命令执行成功后再评估交还 |

## Goal

按实现计划落地 Connecter `:80` HTTP 中继 + 同仓 WorkPet 猫猫球 MVP（WorkPet → Connecter → WP canary）。

## 必读

1. `docs/workpet-connecter-design.md`（D1–D12）  
2. `docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md`  
3. 群公告：多 WorkPanel 交互；Connecter **只中继/调度，不做业务**

## 执行约束

- 默认 `env=canary`；禁止桌宠默认 prod；禁止 WP promote/freeze 生产  
- 开发中继 `CONNECTER_RELAY_PORT=9080`；生产占 80  
- 保留 `npm test`；新增 `npm run test:relay`  
- WP→Connecter、T2 443、流式 = Phase 5 二期  

## 进度

- [x] 设计 + plan + 首 commit docs（`1b19b45`）  
- [x] Phase 0–1 中继 + `RELAY_GATE_OK` / `RELAY_UNIT_OK` / `npm test`（**cs · 2026-08-06**）  
- [ ] Phase 2 systemd  
- [ ] Phase 3 WorkPet  
- [ ] Phase 4 E2E  

### Phase 0–1 简报

- `config/relay.example.json`；边界/README 已对齐「中继+CLI」  
- `src/relay/*` + `bin/connecter-relay.js`；开发 `CONNECTER_RELAY_PORT=9080`  
- 门禁：`npm run test:relay-unit`、`npm test`、`npm run test:relay` → OK  
- 实测 chat → canary messageId `94dd0ad4-…`；pet→prod → 403  

## 变更日志

- 2026-08-06：发起 @codex Goal；随后通道故障，root 确认不再调用 codex → **cs 接手**；双写暂停解除  
