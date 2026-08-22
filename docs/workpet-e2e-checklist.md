# WorkPet × Connecter E2E 验收清单

> 日期：2026-08-06 · 执行：OpenClaw（服务器侧）· 状态：**全部通过 ✅**
> 范围：Phase 4 验收 E1–E7 + 补充「杀进程重启续投」用例（E8）
> 说明：这是早期 E1–E8 联调记录。v0.2.2 已由 Windows workflow 构建 NSIS 安装器，并完成隔离目录安装/启动冒烟；桌面可见渲染仍需目标机器人工确认。

| # | 验收项 | 结果 | 证据 |
|---|--------|------|------|
| E1 | `npm test`（mock 门禁）仍绿 | ✅ | `SMOKE_OK` / `GATE_OK`，exit 0 |
| E2 | `npm run test:canary`（直连适配回归，真实 :8081） | ✅ | exit 0；`canaryBase=http://127.0.0.1:8081`；prod :8080 未触碰 |
| E3 | `npm run test:relay` → `RELAY_GATE_OK` | ✅ | exit 0；sqlite+config pets+poll+idempotent+deadletter+revoke；canary live，instances=2 |
| E4 | 生产形态可听（systemd :9080 + nginx :80），health 通 | ✅ | `:9080/v1/health` 与 `:80/v1/health` 均 `{"ok":true}` |
| E5 | WorkPet 经中继发到「灰度测试」@固定 Agent，有 messageId/runId | ✅ | `WORKPET_GATE_OK`；`msg_workpet_gate_1786002244872` → runId `b0f2d2ef-…`；messages 回显 nextCursor=8 |
| E6 | 无 token 被拒；prod 默认拒 | ✅ | 无 token→401；坏 token→401；pet 打 prod→403 `PROD_FORBIDDEN` |
| E7 | Connecter 无业务网页；无 SSH 依赖 | ✅ | `:9080/` → 401 API-only（非网页）；`:80/` 仍为 nginx（homepage/WP）；部署全走 nginx 反代，零 SSH |
| E8 | **杀进程重启续投**（补充用例） | ✅ | `RESUME_E2E_OK`：注入 accepted 消息 → SIGKILL → 重启 → 30s 内自动续投到 canary，`status=delivered, runs=1` |

## E8 细节（补门禁缺口）

- 脚本：`scripts/e2e-resume-test.js`（`npm run test:e2e-resume`）
- 场景：消息落盘 accepted 后、投递完成前进程被杀 → 重启后 `resumePending()` 启动续投
- 端口：9199（专用测试端口；9191 被其他项目 python3 占用，已规避）

## 遗留（非阻塞）

- Tauri Windows 构建/安装/进程启动：v0.2.2 自动与本地门禁已通过；可见渲染由目标桌面按 `apps/workpet/README.md` 验收。
- 443 TLS（T2）：公网前跟进
- CORS `*`（MVP 放开）：T2 收紧为源白名单
