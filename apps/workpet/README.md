# WorkPet Live2D 桌宠（apps/workpet）

WorkPanel 桌宠入口：透明置顶的 Live2D 角色 + 展开聊天，经 **Connecter 中继**（`/v1/*`，默认 canary）与 WorkPanel 群组交互。静态 SVG 仅作为 Live2D 资源加载失败时的降级。

```
WorkPet(桌面) ──HTTP──► Connecter(:80 nginx → :9080) ──A2A──► WorkPanel(canary :8081)
```

## 目录

| 路径 | 说明 |
|---|---|
| `ui/` | 前端：Live2D 渲染适配层、状态/聊天 UI、Connecter SDK 与静态降级资源 |
| `src-tauri/` | Tauri 2 壳：透明无边框置顶小窗；`get_config` 命令读 `~/.workpet/config.json` |
| `config.example.json` | 桌面配置样例（**默认 canary，禁止指向 prod**） |

## 桌面配置（用户机器）

1. 复制 `config.example.json` → `~/.workpet/config.json`
2. 填三项：
   - `connecterBaseUrl`：`http://<服务器IP>:80`（经 nginx 反代；公网前建议先上 443）
   - `token`：`config/relay.json` 里 `pets[].token`（找管理员要）
   - `group` / `agent`：与 relay 配置中该 pet 绑定的群/Agent 一致
   - `live2d.modelUrl`：应用本地 `model3.json` 路径；`scale` 是自动适配后的倍率，位置可按模型微调
3. 缺配置时应用会提示，不会静默连任何后端

## 构建与运行（需在目标桌面系统上执行）

Tauri 无法跨平台出包（Win 包需在 Windows 构建，macOS 包需在 macOS 构建）。

```bash
cd apps/workpet
npm install                    # 安装 Tauri/Vite/Pixi/Live2D 依赖
npm run test:ui                # UI 配置与状态门禁
npm run dev                    # 开发运行（Vite + Tauri 透明窗口）
npm run build                  # 构建桌面程序
```

前置依赖（按官方文档）：
- Windows：VS Build Tools（含 WebView2 SDK）
- macOS：Xcode Command Line Tools
- 开发机 Linux：webkit2gtk-4.1、libappindicator 等（`sudo apt install libwebkit2gtk-4.1-dev …`）

Windows 也可以直接运行已构建的 debug 程序：

```text
src-tauri/target/debug/workpet.exe
```

未创建 `~/.workpet/config.json` 时，Live2D 角色仍会正常运行，聊天区会进入“仅桌宠模式”。

## 交互

- 点击角色 → 播放互动动作；点击聊天按钮 → 展开聊天面板（窗口 300×420 → 440×680）
- 顶部 `A−` / `A+` 可在 75%～150% 之间调整桌宠大小；也可用 `Ctrl+-` / `Ctrl++`，选择会保存到本机
- 输入回车/发送 → `POST /v1/chat` → 显示 accepted + messageId/runId → 轮询 run 状态
- 面板开着时每 2s 轮询 `GET /v1/messages?since=` 回显（N2 规范）
- 角色状态：`idle`、`thinking`、`speaking`、`error` 映射到模型动作和状态灯
- 顶部拖拽柄移动窗口；收起按钮回到纯桌宠态

Live2D 资源准备、许可边界和验收标准见 [`docs/workpet-live2d-design.md`](../../docs/workpet-live2d-design.md)。Cubism Core、Framework 和模型使用不同许可；应用发布前必须按实际主体和模型来源完成复核。

默认开发模型是 Live2D 官方 Cubism Web Samples 中的 Hiyori；来源提交、原始 License/Notice 和发布检查项见 [`third-party/live2d/README.md`](third-party/live2d/README.md)。生产发布时可通过 `live2d.modelUrl` 换成自有授权模型。

## 门禁（服务器可跑）

```bash
npm run test:workpet   # 用 node 跑 SDK 对线上中继 :80 的契约验证（health/instances/chat/messages/runs）
```

> 注：门禁会向 canary「灰度测试」群发一条真实消息并触发真实 Agent run，属预期行为。
