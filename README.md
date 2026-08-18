# WorkPanelConnecter

多 WorkPanel 协同的 **调度中继 + CLI**。只做调度，不做业务。桌宠 UI：同仓 **WorkPet**。

**MVP（Phase 0–4）已完成** · 下一步见 [NEXT-DEV-PATH](docs/NEXT-DEV-PATH.md)

## 启动方式

### 1. Connecter CLI（交互式命令行）

```bash
npm start
```

启动交互式 REPL，支持 `/chat`、`/show-server`、`/help` 等命令。

### 2. Connecter Relay（HTTP 中继服务器）

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
```

可选：`npm run test:e2e-resume`（杀进程续投）、`npm run test:workpet`。

## 前置依赖

- **Node.js ≥ 18**（跑 CLI / 测试）；**Relay 建议 Node ≥ 22.5**（使用 Node 内置 `node:sqlite`，**不是** `better-sqlite3`）
- WorkPet 桌面应用还需要 **Rust 工具链** 和 **Tauri 2** 系统依赖（Windows：VS Build Tools + WebView2；macOS：Xcode CLI Tools）
- 联调真实调度需 WorkPanel **canary**（默认 `:8081`）可达；默认禁止打 prod

## 文档

| 文档 | 说明 |
|------|------|
| [下一步路径](docs/NEXT-DEV-PATH.md) | P0–P3 开发顺序 |
| [演进方向（Raft/本机 Agent）](docs/CONNECTER-EVOLUTION.md) | **2026-08-10 战略答复：E1–E4** |
| [Relay API 契约](docs/api-relay.md) | `/v1/*` 冻结契约 |
| [运维手册](deploy/README.md) | 备份 / token / systemd |
| [Roadmap](docs/ROADMAP.md) | Phase 0–5 状态 |
| [系统设计](docs/workconnector-system-design.md) | N1–N3 规范 |
| [E2E 清单](docs/workpet-e2e-checklist.md) | E1–E8 |

## 约定

- 默认 **canary**；禁止默认 prod；禁止 WP promote  
- 代码在仓库根 / `src/` / `apps/` / `deploy/`；勿写入 `.linlis/agents/`  
- `config/relay.json` 含 token，已 gitignore，勿提交  
