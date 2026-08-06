# WorkPet 猫猫球（apps/workpet）

WorkPanel 桌宠入口：悬浮猫猫球 + 展开聊天，经 **Connecter 中继**（`/v1/*`，默认 canary）与 WorkPanel 群组交互。

```
WorkPet(桌面) ──HTTP──► Connecter(:80 nginx → :9080) ──A2A──► WorkPanel(canary :8081)
```

## 目录

| 路径 | 说明 |
|---|---|
| `ui/` | 前端：`index.html` + `style.css` + `main.js` + `connecterApi.js`（SDK）+ `skin.svg` |
| `src-tauri/` | Tauri 2 壳：透明无边框置顶小窗；`get_config` 命令读 `~/.workpet/config.json` |
| `config.example.json` | 桌面配置样例（**默认 canary，禁止指向 prod**） |

## 桌面配置（用户机器）

1. 复制 `config.example.json` → `~/.workpet/config.json`
2. 填三项：
   - `connecterBaseUrl`：`http://<服务器IP>:80`（经 nginx 反代；公网前建议先上 443）
   - `token`：`config/relay.json` 里 `pets[].token`（找管理员要）
   - `group` / `agent`：与 relay 配置中该 pet 绑定的群/Agent 一致
3. 缺配置时应用会提示，不会静默连任何后端

## 构建与运行（需在目标桌面系统上执行）

Tauri 无法跨平台出包（Win 包需在 Windows 构建，macOS 包需在 macOS 构建）。

```bash
cd apps/workpet
npm install                    # 拉 @tauri-apps/cli
npm run tauri dev              # 开发运行（起透明小窗）
npm run tauri build            # 出安装包（首次需 `npm run tauri icon ui/skin.svg` 生成图标）
```

前置依赖（按官方文档）：
- Windows：VS Build Tools（含 WebView2 SDK）
- macOS：Xcode Command Line Tools
- 开发机 Linux：webkit2gtk-4.1、libappindicator 等（`sudo apt install libwebkit2gtk-4.1-dev …`）

## 交互

- 点击球 → 展开聊天面板（窗口 120×120 → 360×520）
- 输入回车/发送 → `POST /v1/chat` → 显示 accepted + messageId/runId → 轮询 run 状态
- 面板开着时每 2s 轮询 `GET /v1/messages?since=` 回显（N2 规范）
- 球状态：绿=idle、橙闪=thinking、红=error
- `–` 收起回球

## 门禁（服务器可跑）

```bash
npm run test:workpet   # 用 node 跑 SDK 对线上中继 :80 的契约验证（health/instances/chat/messages/runs）
```

> 注：门禁会向 canary「灰度测试」群发一条真实消息并触发真实 Agent run，属预期行为。
