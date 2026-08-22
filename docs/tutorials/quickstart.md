# Quickstart

本教程从干净检出开始，运行最小 smoke 测试，再启动一个本地 Site Connecter。它不需要真实 WorkPanel、真实 token 或 Connecter Host。

## 1. 准备 Node.js

安装 Node.js 18 或更高版本。运行 Relay、SQLite 和完整测试时建议使用 Node.js 22.5 或更高版本。

```bash
node --version
npm --version
```

## 2. 获取项目并运行 smoke

```bash
git clone https://github.com/linlisWorkTeam/workpanelConnecter.git
cd workpanelConnecter
npm test
```

成功时会看到：

```text
SMOKE_OK
GATE_OK
```

这个 smoke 使用仓库内 mock，不会访问生产 WorkPanel。

## 3. 准备站点 Connecter 配置

复制示例配置，不要修改示例文件：

```bash
cp config/relay.example.json config/relay.json
```

Windows PowerShell：

```powershell
Copy-Item config/relay.example.json config/relay.json
```

至少检查以下字段：

- `listen.port`：本地默认可用 `9080`；
- `backends.canary.baseUrl`：本站 WorkPanel canary 地址；
- `pets[].token`、`runners[].token` 和 `auth.tokens`：仅使用本地测试值；
- `host`：没有 Host 实验时使用 `role: standalone`；
- `allowProdFromPet`：默认保持 `false`。

配置字段详见 [`../reference/configuration.md`](../reference/configuration.md) 和 [`../relay-config.md`](../relay-config.md)。

## 4. 启动 Relay

```bash
CONNECTER_RELAY_CONFIG=config/relay.json CONNECTER_RELAY_PORT=9080 npm run relay
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

## 5. 运行相关门禁

```bash
npm run test:docs
npm run test:relay-unit
npm run test:runner
```

完整本地发布门禁：

```bash
npm run test:release-local
```

## 6. 下一步

- 具体配置问题：看 [How-to](../how-to/README.md)。
- API、CLI 和配置字段：看 [Reference](../reference/README.md)。
- 站点/Host 边界和路线：看 [Explanation](../explanation/README.md)。

<!-- TODO: 根据项目实际补充真实 canary 的安全登录和 WorkPet 桌面验收步骤。 -->
