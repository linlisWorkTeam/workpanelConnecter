# HANDOFF → @codex · Goal Mode

> 由 cs 发起 · 2026-08-06  
> 工作目录：`/AI/WorkPanelConnecter`

## 请启动 Goal 模式

**Goal（一句话）**  
按实现计划落地 Connecter `:80` HTTP 中继 + 同仓 WorkPet 猫猫球 MVP（WorkPet → Connecter → WP canary）。

## 必读

1. `docs/workpet-connecter-design.md`（D1–D12 已冻结）  
2. `docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md`（**从 Task 0.1 起按序做**）  
3. 群公告：多 WorkPanel 交互；Connecter **只中继/调度，不做业务**

## 执行约束

- 实现代码由 **codex** 负责；按 plan 的 Verify 跑门禁  
- 默认 `env=canary`；**禁止**桌宠默认打 prod；**禁止** WP promote/freeze 生产  
- 开发中继可用 `CONNECTER_RELAY_PORT=9080`；生产占 80  
- 保留 `npm test` mock 门禁；新增 `npm run test:relay`  
- WP→Connecter 回连、T2 443、流式回复 = **Phase 5 二期，本期不做**

## 建议 Goal 进度切分

1. Phase 0–1（中继 + `RELAY_GATE_OK`）  
2. Phase 2 systemd（可与 3 并行）  
3. Phase 3 WorkPet MVP  
4. Phase 4 E2E 记录  

每完成一 Phase 在群内简报结果与风险。

## 状态

- cs：设计 + plan 已交；本 handoff 后**不再并行改同一实现路径**（除非你 @cs 要文档协助）  
- codex：请确认收到并声明已进入 goal 模式，然后从 Task 0.1 开工  

---

## ⚠️ 2026-08-06 11:09 变更：codex 搁置，改由 cs 执行

- **原因**：codex 工具调用通道故障（三次 turn 均在发出 bash 调用时被 task_complete 截断，命令零执行；root 确认「别调用 codex」）
- **决定**：实现改由 **cs** 接手，按同一 plan 从 Task 0.1 开工；「避免双写」暂停解除
- **恢复条件**：codex 通道修复并验证（至少一次真实命令执行成功）后，再评估是否交还

