# WorkPanelConnecter

多 WorkPanel 协同的 **调度中继 + CLI**。只做调度，不做业务。桌宠 UI 在同仓 **WorkPet**（独立应用）。

## 文档

| 文档 | 说明 |
|------|------|
| [交接 / Owner](docs/HANDOFF-codex-goal.md) | 当前 **cs** 实现；codex 搁置 |
| [实现计划](docs/superpowers/plans/2026-08-06-workpet-connecter-relay.md) | Phase 0–5 |
| [WorkPet 设计](docs/workpet-connecter-design.md) | D1–D12 |
| [调度边界](docs/scheduling-boundaries.md) | In/Out |
| [Roadmap](docs/ROADMAP.md) | 阶段总览 |

## 中继（Phase 1 + 1.5）

```bash
cp config/relay.example.json config/relay.json   # 含 pets[] 配置式注册；已 gitignore
# 开发（免 root）：
CONNECTER_RELAY_PORT=9080 CONNECTER_RELAY_CONFIG=config/relay.json npm run relay

# 探活
curl -sS http://127.0.0.1:9080/v1/health

# Pet 上行（Bearer = pets[].token）
curl -sS -H "Authorization: Bearer dev-pet-token-change-me" \
  -H 'content-type: application/json' \
  -d '{"id":"msg_demo_1","group":"灰度测试","prompt":"hello"}' \
  http://127.0.0.1:9080/v1/chat

# 轮询回显
curl -sS -H "Authorization: Bearer dev-pet-token-change-me" \
  'http://127.0.0.1:9080/v1/messages?since=0&group=%E7%81%B0%E5%BA%A6%E6%B5%8B%E8%AF%95'
```

生产听 **:80**（Phase 2）。默认 `env=canary` → WP `:8081`。SQLite：`data/connector.db`（WAL）。

门禁：`npm test` · `npm run test:relay`（含幂等/回显/死信/revoke）· `npm run test:canary`

## CLI / 门禁

```bash
npm test              # mock 自包含
npm run test:canary   # 直连 WP 灰度（禁 :8080）
npm run test:relay    # 中继门禁（开发 9080 → canary）
```

## 开发约定

- 代码写在仓库根 / `src/` / `bin/` / `apps/`；勿写入 `.linlis/agents/`
- 实现 Owner：**cs**（codex 通道恢复前）
- 勿 WP promote；勿默认打 prod
