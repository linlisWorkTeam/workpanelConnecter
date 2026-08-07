# WorkPet `~/.workpet/config.json` 填写样例

> 桌面猫猫球读取 **用户主目录下** `.workpet/config.json`（不是项目目录）。
> Windows: `C:\Users\<你>\ .workpet\config.json`；macOS/Linux: `~/.workpet/config.json`。
> 首次使用：把 `apps/workpet/config.example.json` 复制到上述位置再按下面填写。

## 完整样例（可直接复制）

```json
{
  "connecterBaseUrl": "http://<服务器IP或域名>:80",
  "token": "<pet-desktop-1 的 token，见下方获取方法>",
  "env": "canary",
  "group": "灰度测试",
  "agent": "Cursor Agent",
  "pollIntervalMs": 2000,
  "maxRunPolls": 30
}
```

## 字段说明

| 字段 | 必填 | 说明 | 取值示例 |
|---|---|---|---|
| `connecterBaseUrl` | ✅ | 中继服务地址。服务器上 nginx 已把 `/v1/*` 反代到 Connecter(:9080)，**填 `:80` 即可，不要带 `/v1` 后缀**（SDK 自动拼接） | `http://123.45.67.89:80` |
| `token` | ✅ | pet 身份令牌，见下方「如何拿 token」 | `wp_pet_xxxxxxxx` |
| `env` | ✅ | 目标环境。**`canary`（灰度）**；`prod`（生产）被 SDK 强制禁止，填了会 403 | `canary` |
| `group` | ✅ | 目标群名（中继里该 pet 已注册的群） | `灰度测试` |
| `agent` | ✅ | 群内要 @ 的 Agent 显示名（中继按此路由投递） | `Cursor Agent` |
| `pollIntervalMs` | 否 | 轮询回显间隔，默认 2000（毫秒） | `2000` |
| `maxRunPolls` | 否 | 单次消息等待 run 结果的最大轮询次数，默认 30 | `30` |

## 如何拿 token（服务器上执行）

```bash
# 1. 查看已注册的 pet 及其 token
cat /AI/WorkPanelConnecter/config/relay.json | python3 -m json.tool
# 找到 pets[] 里 id="pet-desktop-1" 的 token 字段，复制出来
```

**⚠️ 安全须知**
- `config/relay.json` 含真实 token，已被 `.gitignore` 排除，**不要提交、不要外发**
- 桌面配置 `~/.workpet/config.json` 同样含 token，注意本机文件权限
- 若 token 泄露：在中继 `relay.json` 里删除该 pet 条目并重启服务即可吊销

## 当前服务器的已注册 pet（脱敏参考）

```
pet-desktop-1
  env:   canary
  group: 灰度测试 (groupId 528b36ba-…)
  agent: Cursor Agent
```

> 想新增桌面端（如 pet-desktop-2）：在服务器 `config/relay.json` 的 `pets[]` 加一条
> （新 id + 新 token + 目标群/Agent），重启 `connecter-relay.service` 即可，桌面端填对应值。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动提示「未找到配置」 | 文件不在 `~/.workpet/config.json` | 按本文开头路径放置 |
| `token required` | token 为空 | 填真实 pet token |
| 401 | token 错误/已吊销 | 核对 relay.json 里的值 |
| 403 | env 填了 `prod` | 改为 `canary` |
| 消息发出但无回显 | group/agent 名与中继注册不一致 | 核对 relay.json 里该 pet 的 groups 段 |
