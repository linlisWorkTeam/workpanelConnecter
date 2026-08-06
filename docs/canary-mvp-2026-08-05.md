# MVP Connecter — 灰度验证记录

> 任务：路线图闭环 · MVP版本Connecter · 实施 · **灰度验证并记录结果**  
> 日期：2026-08-05  
> 验证人：Agent cs  
> 环境：本机隔离 mock（**非** LinlisWorkPanel 生产 `:8080` / 灰度 `:8081`）

## 1. 灰度范围定义（本仓）

| 项 | 说明 |
|----|------|
| 灰度对象 | WorkPanelConnecter MVP CLI + mock 协调 Agent |
| 目的 | 在触达真实 WP / 真实 A2A 前，用隔离端点验证跨「服务」调度路径 |
| **明确不做** | 不部署/不重启/不 promote 任何 WorkPanel 生产或灰度槽；不改 WP 数据目录 |

群公告约束：项目解决多 WorkPanel 间交互；本次仅验证 Connecter 调度平面自身。

## 2. 验证步骤与结果

### 2.1 自动化门禁（单 mock A + 离线 B）

```text
命令: npm test
时间: 2026-08-05T06:09:22Z (UTC)
结果: EXIT 0
标志: SMOKE_OK / GATE_OK
```

| 检查项 | 结果 |
|--------|------|
| svc-a 在线 / svc-b 离线 | 通过 |
| `/chat` → A 成功（含 taskId） | 通过 `e1d8df62-1307-46b2-b15e-3d57d297ab67` |
| `/chat` → B 失败（coordinator unavailable，无 worker 旁路） | 通过 |
| `team_metadata` 可见 | 通过 |
| `/restart-server` `/obs` stub | 通过 |
| 调度日志含 success + failed | 通过 |

### 2.2 双 mock 联调（模拟两 WP 均可达）

```text
Mock A: 127.0.0.1:19001 team-a
Mock B: 127.0.0.1:19002 team-b
时间: 2026-08-05T06:09:36.855Z
结果: DUAL_EXIT 0
```

| 检查项 | 结果 |
|--------|------|
| refresh 后 2 online | 通过 |
| chat A | succeeded `3f999993-ed7b-46b6-b80f-b2ddbfd3546e` |
| chat B | succeeded `a5b6003a-6a67-4017-b2fb-57853afd5dda` |
| bothOnline | true |

## 3. 结论

| 判定 | 说明 |
|------|------|
| **灰度通过（MVP / mock 层）** | 门禁 + 双 mock 跨服务调度路径成立 |
| 未晋级项 | 真实 WorkPanel、真实 A2A、生产/灰度槽发布 |

**可否进入下一阶段文档（阶段 C）**：可以基于 mock 契约起草对接文档；对接真实 WP 前须另开 WP 侧灰度，且遵守 WP 生产审批门禁（Connecter Agent **不得**自行 promote）。

## 4. 风险与残留

| 风险 | 等级 | 备注 |
|------|------|------|
| mock HTTP ≠ 生产 A2A | 高 | 联调真实协调 Agent 可能暴露协议差 |
| 无鉴权 | 中 | MVP 可接受；对接前必须补 |
| 仓库无 commit | 低 | 不影响本次验证结论 |
| 误触 WP 生产槽 | — | 本次未执行任何 WP deploy/promote/freeze |

## 5. 证据索引

- 门禁脚本：`scripts/smoke.js`（`npm test`）
- 验收标准：`docs/mvp-status-and-acceptance.md`
- 本记录：`docs/canary-mvp-2026-08-05.md`
