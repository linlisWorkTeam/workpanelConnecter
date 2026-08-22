# WorkPanelConnecter

面向 WorkPanel 站点的 Connecter：连接本站 WorkPet、WorkPanel、User 与 Runner，并通过 Connecter Host 支持跨站消息中继。

[![CI](https://img.shields.io/badge/CI-TODO-lightgrey)](#)
[![Release](https://img.shields.io/badge/release-TODO-lightgrey)](#)

## Features

- Site Connecter：本站 WorkPet/User、WorkPanel 和 Runner 的统一入口。
- 可靠消息：SQLite 持久化、幂等、重试、游标轮询和恢复。
- Runner 接入：出站注册、心跳、任务 lease、ack/renew/result 和 fencing。
- Directory v2：稳定主体、群引用、能力、在线状态和路由解释。
- Federation：Connecter Host 负责站点注册、目录交换和跨站消息中继。
- WorkPet：Tauri 桌面端，只连接本站 Connecter，不直连 Host 或 WorkPanel。

## Quick Start

前置：Node.js 18 或更高版本；运行 Relay 和完整门禁建议 Node.js 22.5 或更高版本。

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm test
```

看到 `SMOKE_OK` 和 `GATE_OK` 即完成最小可复现检查。当前本地发布门禁为 51 项。完整安装、服务启动和桌面端步骤见 [入门教程](docs/tutorials/quickstart.md)。

## Installation

### Source

```bash
npm install
```

启动站点 Connecter 前，复制并填写本地配置：

```bash
cp config/relay.example.json config/relay.json
CONNECTER_RELAY_CONFIG=config/relay.json CONNECTER_RELAY_PORT=9080 npm run relay
```

Windows PowerShell：

```powershell
Copy-Item config/relay.example.json config/relay.json
$env:CONNECTER_RELAY_CONFIG = (Resolve-Path config/relay.json).Path
$env:CONNECTER_RELAY_PORT = "9080"
npm run relay
```

### Windows release

从 [GitHub Releases](https://github.com/linlisWorkTeam/workpanelConnecter/releases) 获取 WorkPet 安装器或 Connecter 便携包。生产使用前请填写自己的配置，并注意当前安装包尚未配置 Authenticode 签名。

## Basic usage

```bash
npm start                   # 交互式 Connecter CLI
npm run relay               # 启动站点 Connecter Relay
npm run test:release-local  # 运行本地发布门禁
```

WorkPet 桌面端：

```bash
cd apps/workpet
npm install
npm run dev
```

桌面配置位于用户目录 `~/.workpet/config.json`，只填写本站 Connecter 地址和凭证。

## Documentation

- [文档首页](docs/index.md)
- [入门教程](docs/tutorials/quickstart.md)
- [操作指南](docs/how-to/README.md)
- [概念解释](docs/explanation/README.md)
- [参考手册](docs/reference/README.md)

项目已有的详细 API、协议、运维和历史记录由 [文档索引](docs/README.md) 统一导航。

## Roadmap

路线图见 [docs/explanation/roadmap.md](docs/explanation/roadmap.md)。

## Changelog

版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## Contributing

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 指引报告。

## License

当前 `package.json` 标注为 `UNLICENSED`，仓库暂未提供公开 `LICENSE` 文件。

<!-- TODO: 根据项目实际补充公开许可证名称、完整许可证文件和徽章链接。 -->
