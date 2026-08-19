---
date: 2026-08-19
topic: workpet-connected-space
branch: main
status: active
---

# Epitaph: WorkPet CONNECTED SPACE / 注册表后续

> 本会话将改由 **agentteam** 调度后续 Agent。先读本文再动代码。

## Built this session

- WorkPet 迷你群控制台：`GET /v1/groups*` 代理 WP；展开面板切群、成员在线、群消息、`@Agent`。
- 合入 origin `d4c5910`：无 `@` **只**打群 `adminMemberId`（`NO_ADMIN`）；`pets[].wpAuth` 以 WP 用户发言；`GET /v1/members`；presence heartbeat（WP canary 未发则 404 跳过）。
- WorkPet 小爱播报：homepage `POST /api/xiaomi/pet-announce`；桌宠 ♪ 开关；run 终态才播。
- CONNECTED SPACE **服务器下拉**：`GET /v1/envs`，`canary` 显示「本地」、`remote` 显示「远端」，选项带 host:port。
- 修复合并丢失的 `let sending = false`（发消息 `ReferenceError`）。

**未进 git（有意）：** `config/relay.json`（gitignore）。本机已把 `backends.canary.baseUrl` 改成 `http://127.0.0.1:8082`（真 WP）。`:8081` 仍是 mock（`local-canary` / `灰度测试`）。

## Key paths

- Relay：`src/relay/handlers.js` · `src/relay/mentions.js` · `src/relay/groupConsole.js` · `src/relay/server.js` · `src/workpanelClient.js`
- WorkPet：`apps/workpet/ui/main.js` · `index.html` · `connecterApi.js` · `petStamp.js`
- 契约：`docs/api-relay.md` · `docs/CONNECTER-EVOLUTION.md` · `docs/NEXT-DEV-PATH.md`
- 规格：`docs/superpowers/specs/2026-08-19-workpet-group-console-design.md`（G7 管理员；G12 wpAuth）

## Locked product decisions

- Pet **只连 Connecter**（G2），不直连 WP，不做桌宠侧 mDNS/扫端口。
- 无 `@` → 群管理员 Agent；有 `@` 须为 agent，否则 `UNKNOWN_MENTION`。
- 发言身份：`pets[].wpAuth`；省略则门面 `backends.*.auth`。
- 切服务器 = 切 Connecter `backends` env，不是桌宠自己发现 WP。
- Roadmap「注册表」= **E1 Runner**（`/v1/agents/*`），**不是** WP 端口自发现。

## Known pitfalls

- 旧中继进程没有 `/v1/groups` → 桌宠「群列表失败：not found」。改代码后必须重启 `npm run relay`。
- 「本地」若仍指向 `:8081` mock，就看不到 `:8082` 上的「接线自举群 / LinlisWorkPanel」。
- 本机 `~/.workpet/config.json` 的 `env` 会随下拉写入；与仓库 `apps/workpet/ui/config.json` 不是同一份。
- **不要** `stash pop`：`wip-e1-before-e2-merge`（E2 已概括 runners）、`wip-capabilities-schema`。
- linlisHomePage 小爱 endpoint 若未 push / `:8000` 未起，播报会「小爱没播出去」。
- WP 群「WorkPanelConnecter」成员里没有名为 dsh 的 Agent；`@dsh` 会 UNKNOWN 或误打到 cs（视 mention 解析）。
- `pickSender`：成员 `authUserId` 必须绑上登录 user；未绑且 owner 已有 authUserId 时可能 `no sender user linked`。

## How to run / verify

```text
# 中继（读 gitignore 的 config/relay.json）
npm run relay

# 桌宠 debug
cd apps/workpet && npm run dev

# 单测
npm run test:relay-unit
npm run test:group-console
npm run test:mentions
npm run test:identity
npm run test:runner
cd apps/workpet && npm run test:ui
```

冒烟：展开 CONNECTED SPACE → 下拉应见 `本地 · 127.0.0.1:8082` 与远端；切本地群为 8082 上的群；切远端为云上群。本机 WP：`http://127.0.0.1:8082/`。

## Do not regress

- `GET /v1/groups*` 与 `GET /v1/members` 并存；chat 无 `@` 不得回落「任意第一个 Agent」。
- Pet+prod 默认 403 `PROD_FORBIDDEN`；下拉过滤 `prod`。
- 乐观气泡与 `【WorkPet:{petName}】` 去重；XiaoAi 只在 `completed|failed|error|delivered` 播一次。
- Runner 入队 `content` 用用户 rest（无戳记），WP 转发用 formatted stamp。

## Open follow-ups（agentteam 下一刀）

优先（用户已拍「调研注册表」，未开工）：

1. **WP 槽位健康（小）**：Connecter 探 `backends.*.baseUrl/api/health`，`GET /v1/envs` 带 `alive` + baseUrl；下拉里灰掉挂掉的槽。仍不扫描局域网。
2. **WP 自注册（中，需 WP）**：本机 WP 启动出站登记到 Connecter（与 E1 `/v1/agents/register` 同构：register + heartbeat + TTL）。换端口不必改 `relay.json`。接近 E3 Team↔Team，不是现成 API。
3. **不要**在 WorkPet 做 mDNS / 扫 8081–8082。

其余未做：

- P2.5：WP canary 发布 presence heartbeat；群成员绑 `authUserId`；relay.json 配 `pets[].wpAuth`（真用户，勿把密码写进 git）。
- 规格 §4.4 每群 `relay.json` `agentName` 仍不参与无 `@` 路由（现以管理员为准）。
- 未 push：`D:\AI\linlisHomePage` 的 pet-announce（若还要云上小爱）。
- E3 / E4；P3.2 `POST /v1/register`（Pet 登记，别和 WP 槽位表搞混）。
