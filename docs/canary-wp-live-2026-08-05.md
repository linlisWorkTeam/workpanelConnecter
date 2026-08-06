# Connecter × WorkPanel 灰度联调记录（无 mock）

> 日期：2026-08-05  
> 验证人：Agent cs  
> 槽位：**仅 canary `:8081`**（生产 `:8080` 未改、未打）

## 1. 改动摘要

| 项 | 说明 |
|----|------|
| `src/workpanelClient.js` | 真实 WP：登录、`/api/health`、群成员 → `team_metadata`、`POST /api/messages` @协调 Agent |
| `src/coordinator.js` | `kind: workpanel` 走真实 API；否则仍走 mock HTTP |
| `config/servers.canary.json` | 指向 `:8081` + 群「灰度测试」 |
| `npm run test:canary` | 无 mock 门禁；拒绝配置里出现 `:8080` |

协调语义（过渡）：群 **admin Agent**（可配置 `coordinatorAgentName`）作为协调门面；内部工作 Agent 仍由 WP 调度，Connecter 不直连。

## 2. 验证结果

```text
命令: npm run test:canary
结果: EXIT 0 / CANARY_GATE_OK
时间: 2026-08-05T07:04:29Z
```

| 检查 | 结果 |
|------|------|
| wp-canary 在线 | 是 |
| 真实 `team_metadata`（含 Cursor Agent / OpenClaw / codex） | 是 |
| `/chat` → 灰度测试 @Cursor Agent | **accepted** messageId=`62864a3a-8539-437e-a607-9d576f9527b5` runId=`0b19ff74-0755-47d3-bf13-0c961e8cfbf4` |
| 不可达槽失败且无旁路 | 是 |
| 生产 `:8080` | **未触碰** |

单元 mock 门禁 `npm test` 仍保留（本地无 WP 时用）。

## 3. 使用方式

```bash
# 真实灰度（需 :8081 已起）
npm run test:canary
CONNECTER_CONFIG=config/servers.canary.json npm start
```

可选环境变量：`CONNECTER_WP_USER` / `CONNECTER_WP_PASS`（默认 root/root，与 WP canary 脚本一致）。

## 4. 风险

| 风险 | 说明 |
|------|------|
| 会触发真实 Agent run | `@` 协调 Agent 会在灰度群产生 run；勿对生产群误配 |
| 尚非独立「非 AI 协调 Agent」 | 目前用群 admin Agent 门面；阶段 D 需替换为专用协调器 |
| 成功=消息受理 | 不代表 Agent 已跑完；异步终态需后续订阅 runs |
| 凭证 | canary 默认 root/root；勿把生产密钥写进仓库 |
