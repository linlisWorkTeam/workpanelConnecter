---
date: 2026-09-02
status: ready-to-merge
---

# Self-Marketing 与远程 Runner 联合验收

## Outcome

- 本机 Relay `:9080` 与 `codex-windows11` Runner 对 ECS WorkPanel canary `:8081` 完成 register / heartbeat / poll / ack / result 闭环。
- 最新 `npm run gate:codex-runner-canary` 返回证明串 `DEVICE_CODEX_ECS_CANARY_OK_9d2bce43|workpanel-connecter|0.2.3`，任务 `codex_canary_f49cf352-c6d7-4354-82cb-83eaba432bca` 在 ECS 群消息中完成，Runner 工作树保持不变。
- 独立审查任务 `self_marketing_review_29195134-c703-495e-8a6c-22352e4f9e42` 返回 `SELF_MARKETING_CONNECTER_REVIEW_822401ae`，正确识别 Self-Marketing campaign、ECS 本机 Agent credential failure layer 和 Connecter Runner active 状态。

## Fix made during acceptance

Canary 重启后，WorkPanel `/api/auth/login` 实测约 5.4 秒。Relay 的 chat dispatch 把登录 timeout 固定压到 5 秒，导致健康服务被误判为超时。`dispatchWorkPanel` 现在使用独立的 `wpDispatchLoginTimeout()`：调用者预算不足 15 秒时沿用预算，较大预算封顶 15 秒；`probeWorkPanel` 的 5 秒健康探针不变。

## Verification

```bash
npm run test:group-console
npm test
npm run test:relay-unit
npm run test:relay
npm run test:e2e-resume
npm run gate:codex-runner-canary
npm run test:release-local
```

完整本地发布门禁最终返回 `RELEASE_LOCAL_GATE_OK gates=51`。验收中同步修复了 SQL migration checksum 的 CRLF/LF 跨平台稳定性，并让 migration-copy / backup-restore 覆盖新 migration 013；旧数据库记录的原始 checksum 仍兼容，不会被重写。

## Evidence boundary

- 此验收证明单一 Connecter 下真实远程 Agent 的在线状态和调度链路，不等于多 Connecter Raft/etcd HA 已完成。
- ECS 本机 Content Planner/Writer 凭据仍无效；真实五渠道内容生成在 Windows 隔离 WorkPanel + 已登录 Codex CLI 完成。
- `artifacts/visual-acceptance/` 下既有未跟踪截图属于用户资产，未修改、未提交。
