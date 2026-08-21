# WorkPanelConnecter

WorkPanel 的站点连接与联邦中间件。每个站点部署一台 **Connecter**，连接本站的 **WorkPet、WorkPanel、User 与 Runner/Agent**；全网部署一台中心化 **Connecter Host**，负责各 Connecter 的注册、目录交换和跨站消息中继。Host 不直接连接 WorkPet、WorkPanel 或 Runner，站内流量也不绕行 Host。

桥接定位与设计见 [docs/bridge-deepseek-harness.md](docs/bridge-deepseek-harness.md)。

DeepSeek Harness 只是可接入的 Runner 实现之一，不是 Connecter 的产品边界。当前 P0–P3 本地实现与 51 项发布门禁状态见 [P0–P3 实现状态](docs/P0-P3-IMPLEMENTATION-STATUS.md)。文档权威关系与历史快照边界见 [文档索引](docs/README.md)。

## 启动方式

### Windows 一键安装 / 运行

从 [GitHub Releases](https://github.com/linlisWorkTeam/workpanelConnecter/releases) 下载：

- `WorkPet_<version>_x64-setup.exe`：Windows 桌面端安装器，双击安装；
- `WorkPanelConnecter_<version>_win-x64-portable.zip`：站点 Connecter 自包含包，无需另装 Node.js。解压后先复制并填写 `config/relay.json`，再运行 `WorkPanelConnecter.exe`；
- `SHA256SUMS.txt`：下载完整性校验值。

当前安装包尚未配置商业代码签名，Windows SmartScreen 可能显示“未知发布者”。构建、启动和健康检查均由 Windows 发布任务自动验证。

### 1. Connecter CLI（交互式命令行）

```bash
npm start
```

启动交互式 REPL，支持 `/chat`、`/show-server`、`/help` 等命令。

### 2. Connecter（站点服务）

```bash
# 先创建配置文件
cp config/relay.example.json config/relay.json

# 然后启动（开发模式，端口 9080）
CONNECTER_RELAY_PORT=9080 CONNECTER_RELAY_CONFIG=config/relay.json npm run relay
```

生产经 nginx `:80` → systemd `:9080`，见 [deploy/README.md](deploy/README.md)。

### 3. WorkPet 桌面应用（Tauri 2）

```bash
cd apps/workpet
npm install
npm run dev          # 开发模式（tauri dev）
```

仅调 UI 时，可用浏览器直接打开 `apps/workpet/ui/index.html`（或本地静态服务）；完整桌宠窗体仍需 `npm run dev`。

桌面配置：复制 `apps/workpet/config.example.json` → `~/.workpet/config.json`，详见 [apps/workpet/README.md](apps/workpet/README.md)。

### 4. 测试

```bash
npm test                # 冒烟测试（mock）
npm run test:canary     # 直连 WP 灰度 :8081
npm run test:relay      # 中继网关门禁
npm run test:runner     # 可插拔 runner 队列/串行/TTL（无 WP）
npm run test:e2-canary  # E2 实调用 canary :8081 + wp-runner（无 mock）
npm run test:release-local # P0–P3 全量本地发布门禁（51 项，fail-fast）
npm run test:docs          # Markdown 链接、命令、路由覆盖与陈旧状态检查
npm run build:windows      # Windows：生成 WorkPet NSIS + Connecter 自包含包
```

可选：`npm run test:e2e-resume`（杀进程续投）、`npm run test:workpet`。

真实 canary 地址或群 fixture 与默认值不同时，可用 `CONNECTER_CANARY_URL`、`CONNECTER_CANARY_GROUP_ID`、`CONNECTER_CANARY_GROUP_NAME` 覆盖 `test:e2-canary`；脚本始终拒绝 `:8080` 生产端口。

## 前置依赖

- **Node.js ≥ 18**（跑 CLI / 测试）；**Relay 建议 Node ≥ 22.5**（使用 Node 内置 `node:sqlite`，**不是** `better-sqlite3`）
- WorkPet 桌面应用还需要 **Rust 工具链** 和 **Tauri 2** 系统依赖（Windows：VS Build Tools + WebView2；macOS：Xcode CLI Tools）
- 联调真实调度需 WorkPanel **canary**（默认 `:8081`）可达；默认禁止打 prod

## 文档

| 文档 | 说明 |
|------|------|
| [桥接设计（WorkPanel × DeepSeek Harness）](docs/bridge-deepseek-harness.md) | 本项目定位：连接各 WP 与 dsh 的桥上中继 |
| [下一步路径](docs/NEXT-DEV-PATH.md) | P0–P3 开发顺序 |
| [演进方向（Raft/本机 Agent）](docs/CONNECTER-EVOLUTION.md) | **2026-08-10 战略答复：E1–E4** |
| [P0–P3 实现状态](docs/P0-P3-IMPLEMENTATION-STATUS.md) | 本地门禁、证据边界与外部验收项 |
| [跨站联邦协议](docs/protocol/federation-v1.md) | Connecter ↔ Connecter Host 消息契约 |
| [联邦本地实验室](docs/runbooks/federation-local-lab.md) | 双站点、Host 与故障恢复验证 |
| [Relay API 契约](docs/api-relay.md) | `/v1/*` 冻结契约 |
| [运维手册](deploy/README.md) | 备份 / token / systemd |
| [Roadmap](docs/ROADMAP.md) | Phase 0–5 状态 |
| [系统设计](docs/workconnector-system-design.md) | N1–N3 规范 |
| [E2E 清单](docs/workpet-e2e-checklist.md) | E1–E8 |

## 约定

- 默认 **canary**；禁止默认 prod；禁止 WP promote
- 代码在仓库根 / `src/` / `apps/` / `deploy/`；勿写入 `.linlis/agents/`
- `config/relay.json` 含 token，已 gitignore，勿提交
