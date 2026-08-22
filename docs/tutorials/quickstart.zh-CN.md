# 入门教程

[English](quickstart.md) · [简体中文](quickstart.zh-CN.md)

本教程从干净检出开始，运行最小 smoke 测试，再启动一个本地 Site Connecter。不需要真实 WorkPanel、真实 token 或 Connecter Host。

## 1. 安装 Node.js

使用 Node.js 18 或更高版本。运行 Relay、SQLite 和完整测试时建议使用 Node.js 22.5 或更高版本。

```bash
node --version
npm --version
```

## 2. 获取项目并运行 smoke

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm install
npm test
```

成功时会看到：

```text
SMOKE_OK
GATE_OK
```

这个 smoke 使用仓库内 mock，不会访问生产 WorkPanel。

## 3. 准备站点 Connecter 配置

复制示例配置，不要修改或提交示例文件：

```bash
cp config/relay.example.json config/relay.json
```

Windows PowerShell：

```powershell
Copy-Item config/relay.example.json config/relay.json
```

至少检查以下字段：

- `listen.port`：本地开发使用 `9080`；
- `backends.canary.baseUrl`：本站 WorkPanel canary 地址；
- `pets[].token`、`runners[].token` 和 `auth.tokens`：仅使用本地测试值；
- `host`：没有 Host 实验时使用 `role: standalone`；
- `allowProdFromPet`：除非经过明确审查，否则保持默认值 `false`。

配置字段详见[配置参考](../reference/configuration.zh-CN.md)和[Relay 详细配置](../relay-config.md)。

## 4. 启动 Relay

```bash
CONNECTER_RELAY_CONFIG="$PWD/config/relay.json" \
CONNECTER_RELAY_PORT=9080 \
npm run relay
```

PowerShell：

```powershell
$env:CONNECTER_RELAY_CONFIG = (Resolve-Path config/relay.json).Path
$env:CONNECTER_RELAY_PORT = "9080"
npm run relay
```

另开一个终端检查健康状态：

```bash
curl http://127.0.0.1:9080/v1/health
```

## 5. 运行专项门禁

```bash
npm run test:docs
npm run test:relay-unit
npm run test:runner
```

完整本地发布门禁：

```bash
npm run test:release-local
```

## 6. 继续选择集成方式

- [操作指南](../how-to/README.zh-CN.md)：任务式操作；
- [参考手册](../reference/README.zh-CN.md)：CLI、配置和 API；
- [概念解释](../explanation/README.zh-CN.md)：站点/Host 边界和路线图；
- [WorkPet 配置](../../apps/workpet/README.md)：桌面端开发。

<!-- TODO: 根据项目实际补充真实 canary 的安全登录和 WorkPet 桌面验收步骤。 -->
