# HANDOFF · Connecter 实现交接

> 文档状态：历史交接记录，不是当前任务清单。当前开发路径见 `NEXT-DEV-PATH.md`。

> 工作目录：`/AI/WorkPanelConnecter`  
> 更新：2026-08-07（进度核对）

## 当前 Owner

| 角色 | 状态 |
|------|------|
| **cs** | MVP 主路径已落地；后续按需迭代 |
| **codex** | **搁置**（工具调用通道故障）；恢复条件：至少一次真实命令执行成功 |

## Goal

Connecter `:80` HTTP 中继 + 同仓 WorkPet 猫猫球 MVP（WorkPet → Connecter → WP canary）。

## 进度（相对 plan）

| Phase | 内容 | 状态 | 证据 |
|-------|------|------|------|
| 0–1 | 中继核 + 门禁 | ✅ | `4b29ca9` |
| 1.5 | SQLite / 配置 pets / 轮询 / 幂等 | ✅ | 同上 |
| 2 | systemd + nginx :80 | ✅ | `fb6c49d` |
| 3 | WorkPet 猫猫球（Tauri） | ✅ | `ac17952` |
| 4 | E2E E1–E8 + 灰度记录 | ✅ | `f7db1bc` · `docs/workpet-e2e-checklist.md` |
| 5（二期） | WP→Connecter、WS、动态注册、流式… | ⏳ 未做 | plan Phase 5 |

**HEAD：** `f7db1bc` — Phase 4 E2E 全绿 + canary 记录（2026-08-06）

## 约束（仍有效）

- 默认 canary；禁默认 prod；禁 WP promote  
- 开发 `9080` / 生产经 :80（见 `deploy/`）  
- 门禁：`npm test` · `npm run test:relay` ·（有 GUI 时）WorkPet  

## 下一步

统一见 **`docs/NEXT-DEV-PATH.md`**（P0 收口 → P1 443 → P2 WP 回连）。本 HANDOFF 只记 Owner/MVP 进度。
