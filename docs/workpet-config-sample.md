# WorkPet `~/.workpet/config.json` 配置

WorkPet 读取用户主目录下的 `.workpet/config.json`。Windows 路径为 `C:\Users\<用户名>\.workpet\config.json`，macOS/Linux 为 `~/.workpet/config.json`。可从 [`apps/workpet/config.example.json`](../apps/workpet/config.example.json) 复制模板。

```json
{
  "connecterBaseUrl": "http://127.0.0.1:9080",
  "preferLocalConnecter": true,
  "token": "REPLACE_WITH_PET_TOKEN_FROM_RELAY_CONFIG",
  "env": "canary",
  "group": "local-canary",
  "agent": "cs",
  "pollIntervalMs": 2000,
  "maxRunPolls": 30,
  "xiaoaiAnnounce": false,
  "homepageBaseUrl": "http://127.0.0.1:8000",
  "homepagePetToken": "REPLACE_WITH_HOMEPAGE_XIAOMI_PET_TOKEN",
  "ui": { "petScale": 1.0 },
  "pet": { "mode": "live2d", "spriteSkin": "default", "live2dId": "hiyori" },
  "live2d": {
    "modelUrl": "models/hiyori/Hiyori.model3.json",
    "scale": 1.0,
    "offsetX": 0,
    "offsetY": 8,
    "motions": { "idle": "Idle", "thinking": "Idle", "speaking": "TapBody", "error": "Idle" }
  }
}
```

## 字段与行为

| 字段 | 说明 |
|---|---|
| `connecterBaseUrl` | Connecter 根地址，不带 `/v1` |
| `preferLocalConnecter` | 默认 `true`；启用时 WorkPet 绑定本机 `127.0.0.1:9080`，跨站消息由 Connecter/Host 转发 |
| `token` | WorkPet bearer token；也可留空后在登录 overlay 使用 WorkPanel 用户名/密码，`POST /v1/auth/login` 会返回并持久化会话 token |
| `env/group/agent` | 缺省 WorkPanel 环境、群和 Agent 显示名 |
| `pollIntervalMs/maxRunPolls` | 消息与 run 结果轮询参数 |
| `xiaoaiAnnounce` | 是否向独立 homepage 服务播报；与 Connecter federation 无关 |
| `homepageBaseUrl/homepagePetToken` | 小爱播报服务地址和独立 token，仅在启用播报时需要 |
| `ui.petScale` | 桌宠窗口缩放 |
| `pet` | `live2d`/`sprite` 模式与本地皮肤 ID |
| `live2d` | 本地 `.model3.json`、缩放、偏移和状态动作组 |

`preferLocalConnecter=false` 时才会使用显式远端 `connecterBaseUrl`；标准部署仍要求 WorkPet 只连接本站 Connecter。

## 安全与排错

- `config/relay.json` 和用户目录的 WorkPet 配置都可能含真实凭证，禁止提交或外传。
- 401 通常表示 token 错误、过期或已吊销；可重新登录。
- 403 可能来自 `allowProdFromPet=false` 或身份权限不足。
- `token required` 表示尚未登录且配置中没有可用 token。
- 消息无回显时，核对群/Agent 绑定，并检查本站 Connecter、Host peer 和目标 Runner 的在线状态。
