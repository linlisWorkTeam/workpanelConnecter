# Configuration reference

| 文件/变量 | 用途 |
|---|---|
| `config/relay.json` | 本地 Site Connecter 配置，已被 gitignore。 |
| `config/relay.schema.json` | Relay 配置字段 schema。 |
| `CONNECTER_RELAY_CONFIG` | 覆盖 Relay 配置文件路径。 |
| `CONNECTER_RELAY_HOST` | 覆盖监听地址。 |
| `CONNECTER_RELAY_PORT` | 覆盖监听端口。 |
| `~/.workpet/config.json` | WorkPet 桌面端本地配置。 |

常见配置区块：`listen`、`db`、`auth`、`backends`、`defaults`、`host`、`runners`、`pets`、`enrollment` 和 `federation`。

完整字段以 [`../../config/relay.schema.json`](../../config/relay.schema.json) 和 [`../relay-config.md`](../relay-config.md) 为准。

安全要求：不要把真实 token、密码、证书、私钥、签名 secret 或 `data/connector.db` 提交到 Git。

<!-- TODO: 根据项目实际补充每个字段的默认值、类型和兼容性矩阵。 -->
