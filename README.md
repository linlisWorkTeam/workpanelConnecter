# WorkPanelConnecter

面向 WorkPanel 站点的 Connecter：连接本站 WorkPet、WorkPanel、用户和 Runner，并通过 Connecter Host 转发跨站消息。

[![CI](https://img.shields.io/badge/CI-TODO-lightgrey)](#)
[![Release](https://img.shields.io/badge/release-v0.2.3-blue)](https://github.com/linlisWorkTeam/workpanelConnecter/releases)

## 项目介绍

WorkPanelConnecter 是一个站点连接层和跨站中继服务。每个站点运行一个 Connecter：

- WorkPet、WorkPanel、用户和 Runner 连接本站 Connecter；
- Connecter 负责本地身份、消息持久化、轮询、Runner 任务 lease 和结果回传；
- Connecter Host 负责站点注册、目录汇聚和跨站消息中继；
- WorkPanel 仍然负责群组和消息业务，Runner 负责实际任务执行。

### 适用场景

- 在本地或服务器上运行一个 WorkPanel 站点 Connecter；
- 让 WorkPet 通过 Connecter 向已配置的 WorkPanel 群组发送消息，并轮询结果；
- 接入已配置的 Runner，完成注册、心跳、任务领取、确认和结果回传；
- 在多个站点之间通过 Connecter Host 转发消息。

### 不支持与边界限制

- Connecter 不是 WorkPanel，不提供群组管理、聊天 UI 或业务数据源；
- Connecter 不是 Agent 执行器，Host 也不执行 Agent；
- WorkPet 不应直连 Connecter Host 或 WorkPanel，标准部署只连接本站 Connecter；
- `npm start` 提供的是兼容运维 CLI，不是完整的跨站控制台；
- WebSocket/SSE 不是当前默认消息回传方式，WorkPet 使用游标轮询；
- 当前仓库没有证明真实双站点与独立 Host 的生产部署、生产 CA/mTLS 密钥轮换、外部告警、72 小时 soak 或 Windows Authenticode 签名，不能据此宣称生产就绪。

## 快速上手

### 环境依赖

- Node.js 18 或更高版本；
- npm；
- 运行 Relay、SQLite 和完整本地门禁建议使用 Node.js 22.5 或更高版本；
- 运行 WorkPet 桌面端还需要 Rust、Tauri 和目标系统的 WebView 构建依赖。

### 方式一：运行本地 smoke（无需真实 WorkPanel）

这是最小可复现示例，使用仓库内 mock 服务，不会访问生产环境。

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm install
npm test
```

成功时应看到：

```text
SMOKE_OK
GATE_OK
```

### 方式二：启动站点 Connecter Relay

复制配置样例后再填写本站 WorkPanel、token 和 Host 信息。不要把真实凭证提交到 Git。

```bash
cp config/relay.example.json config/relay.json
CONNECTER_RELAY_CONFIG="$PWD/config/relay.json" \
CONNECTER_RELAY_PORT=9080 \
npm run relay
```

Windows PowerShell：

```powershell
Copy-Item config/relay.example.json config/relay.json
$env:CONNECTER_RELAY_CONFIG = (Resolve-Path config/relay.json).Path
$env:CONNECTER_RELAY_PORT = "9080"
npm run relay
```

另开终端检查健康状态：

```bash
curl http://127.0.0.1:9080/v1/health
```

健康检查不需要 token；其他业务接口通常需要 Bearer token。配置字段见[配置参考](docs/reference/configuration.md)，完整启动流程见[入门教程](docs/tutorials/quickstart.md)。

### 方式三：启动兼容运维 CLI

```bash
npm start
```

CLI 启动时会读取 `config/servers.json`；文件不存在时会从 `config/servers.example.json` 创建。进入交互界面后可使用：

```text
/refresh
/show-server
/show-team svc-a /team-a
/chat svc-a /team-a
```

CLI 只适合查看和调度已配置的服务，不替代 Relay 或跨站 Host。命令详情见[CLI 参考](docs/reference/cli.md)。

### 方式四：启动 WorkPet 桌面端

先启动本站 Connecter，并准备用户目录下的 `~/.workpet/config.json`。可从 [`apps/workpet/config.example.json`](apps/workpet/config.example.json) 复制后填写 Connecter 地址和 WorkPet token。

```bash
cd apps/workpet
npm install
npm run test:ui
npm run dev
```

WorkPet 默认连接 `http://127.0.0.1:9080`；生产或跨站场景仍应让它连接绑定的本站 Connecter，不要填 Host 地址。桌面依赖、配置字段和安全注意事项见 [`apps/workpet/README.md`](apps/workpet/README.md) 与 [WorkPet 配置参考](docs/workpet-config-sample.md)。

### 最小 HTTP 示例

下面的 Node.js 18+ 示例只调用公开健康接口，可直接保存为 `health.mjs` 后运行：

```js
const response = await fetch('http://127.0.0.1:9080/v1/health');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
console.log(await response.json());
```

```bash
node health.mjs
```

发送聊天、查询消息和 Runner API 需要有效身份与正确绑定；请先阅读 [API 参考](docs/reference/api.md)，不要把示例 token 用于生产环境。

## FAQ

### 必须运行 WorkPanel 才能执行 `npm test` 吗？

不需要。`npm test` 使用仓库内 mock，适合验证安装和基础 CLI 行为；真实 WorkPanel 联调需要按配置参考准备服务。

### `npm run relay` 和 `npm start` 有什么区别？

`npm run relay` 启动 HTTP Relay，是 WorkPet、WorkPanel 和 Runner 的站点连接入口；`npm start` 启动兼容的交互式运维 CLI。

### WorkPet 应该连接哪个地址？

连接它所在站点的 Connecter，例如本机开发时是 `http://127.0.0.1:9080`。不要让 WorkPet 直连 Connecter Host 或 WorkPanel。

### 为什么接口返回 401 或 403？

401 通常表示 token 缺失、错误、过期或已吊销；403 可能是身份没有权限，或 `allowProdFromPet` 禁止 WorkPet 访问生产环境。先检查配置中的身份、群组和环境绑定。

### 这个项目是否已经适合生产环境？

本地自动化门禁已覆盖核心功能，但真实双站点部署、生产证书和密钥轮换、外部告警、长时间 soak 与代码签名仍有证据边界。生产上线前必须完成这些验证并自行审查配置。

### 详细 API、配置和架构在哪里？

从 [文档首页](docs/index.md) 进入 Tutorials、How-to、Explanation 和 Reference。README 只保留入口和最小示例。

---

## 开发者贡献指南

普通使用者无需阅读本节；贡献代码或修改文档时请阅读完整的 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

### 本地构建与编译

```bash
npm install
npm test
npm run test:docs
```

构建 WorkPet 桌面端：

```bash
cd apps/workpet
npm install
npm run test:ui
npm run build
```

Windows 发布包由仓库根目录的 `npm run build:windows` 生成；需要在 Windows 构建机上准备 Tauri/Rust 依赖。

### 单元测试与发布门禁

```bash
npm test
npm run test:docs
npm run test:relay-unit
npm run test:runner
npm run test:release-local
```

当前本地发布门禁为 51 项；数量随测试脚本变化，应以实际运行结果为准。

涉及 Relay、Runner、Federation、安全或配置的改动，应运行相关 `test:*` 门禁，并在 PR 中说明结果。测试可能启动本地 mock、写入临时 SQLite 或生成本地运行数据。

### PR 说明

1. 从最新 `main` 创建分支，保持一个 PR 聚焦一个主题；
2. 不提交 token、证书私钥、数据库、构建产物或本地配置；
3. 提交可复现的测试命令和结果；
4. 在 PR 中说明兼容性、配置变化、风险和回滚方式；
5. 文档改动遵循 `docs/` 下的 Diátaxis 分类，并保持 README 只作为入口。

## License

当前 `package.json` 标注为 `UNLICENSED`，仓库暂未提供公开 `LICENSE` 文件。许可证名称、完整许可证文本和徽章链接待项目维护者确认。

<!-- TODO: 根据项目实际补充公开许可证名称、完整许可证文件和徽章链接。 -->
