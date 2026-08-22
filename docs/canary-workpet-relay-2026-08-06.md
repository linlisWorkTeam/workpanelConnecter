# 灰度验证记录 · WorkPet × Connecter 中继（2026-08-06）

> 文档状态：历史验证快照。文中的环境地址和消息 ID 不代表当前运行状态。

> 环境：canary WP `http://127.0.0.1:8081`（真实服务，无 mock）· 群：「灰度测试」
> 链路：WorkPet SDK / 门禁 → nginx `:80` → Connecter `:9080`（systemd）→ canary `:8081`

## 实测时间线（2026-08-06）

| 时间 | 动作 | messageId | runId / 结果 |
|------|------|-----------|--------------|
| 12:02 | Phase 2 上线验证（经 :80 真实 chat） | `msg_phase2_verify_001` | runId `59b74233-9825-4788-9e4f-1be1c5884188`；wpMessageId `9e581467-…` |
| 14:2x | WorkPet SDK 门禁（首次全绿） | `msg_workpet_gate_1785997419097` | runId `912514d5-2cb7-4185-9d05-87cdc35c04d5` |
| 14:2x | WorkPet SDK 门禁（复跑） | `msg_workpet_gate_1785997429075` | runId `0cb2f9e6-30b3-4b8d-824f-c51f5aca947b` |
| 15:4x | E2E E5（最终验收） | `msg_workpet_gate_1786002244872` | runId `b0f2d2ef-0e1f-4d7d-9864-396a5ca2c8b5`；回显 nextCursor=8 |
| 15:4x | E2E E8（重启续投） | `msg_resume_e2e_1786002228996` | 续投成功：`delivered`，runs=1（经 SIGKILL 重启后自动补投） |

## 门禁汇总（当日全绿）

- `npm test` → `SMOKE_OK` / `GATE_OK`
- `npm run test:canary` → exit 0（真实 :8081）
- `npm run test:relay` → `RELAY_GATE_OK`（canary live）
- `npm run test:workpet` → `WORKPET_GATE_OK`
- `npm run test:e2e-resume` → `RESUME_E2E_OK`

## 安全确认

- ❌ **未触碰** prod `:8080`：无 promote / freeze / 任何 prod 写操作（E2 与 E6 均显式验证 prod 拒绝路径）
- ❌ 无 token / 坏 token → 401；pet→prod → 403 `PROD_FORBIDDEN`
- ✅ `config/relay.json` 真实 token 仅存于服务器（gitignored）

## 已知影响

- 上述验证消息在「灰度测试」群产生真实 Agent run（预期行为，灰度环境）
