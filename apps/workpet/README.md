# WorkPet Live2D 桌宠（apps/workpet）

WorkPanel 桌宠入口：透明置顶角色 + 展开聊天。形象有两种加载模式：**Live2D**（默认 Cubism）和 **状态动图**（idle/thinking/speaking/error 各一张 webp/png/gif/svg）。右键点角色切换；上传拷到 `~/.workpet/models/` 或 `~/.workpet/skins/`，不进安装目录。UI 名 **WorkPet**；只连自己绑定的 **Connecter**（`/v1/*`），不连 Connecter Host、不直连 WorkPanel。自带剪影 `skin.svg` 是动图默认皮肤，也是 Live2D 加载失败时的降级。

```
WorkPet ──绑定──► Connecter(:80 nginx → :9080) ──► 本站 WorkPanel
                     │
                     ▼  （跨站才走，E3 未实现）
                Connecter Host
```

## 目录

| 路径 | 说明 |
|---|---|
| `ui/` | 前端：Live2D 渲染适配层、状态/聊天 UI、Connecter SDK 与静态降级资源 |
| `src-tauri/` | Tauri 2 壳：透明无边框置顶小窗；`get_config` 命令读 `~/.workpet/config.json` |
| `config.example.json` | 桌面配置样例（**默认 canary，禁止指向 prod**） |

## 桌面配置（用户机器）

1. 复制 `config.example.json` → `~/.workpet/config.json`
2. 必填（Connecter 聊天）：
   - `connecterBaseUrl`：这只宠绑定的 **本站 Connecter**（默认 `http://127.0.0.1:9080`）。公网 ECS 地址不算本环境，启动时会优先改回本机/局域网 Connecter。跨站走 Host（尚未实现），不要把桌宠直接绑到别的站。
   - `preferLocalConnecter`：默认 `true`。设为 `false` 才允许绑到非本环境 URL。
   - `token`：那一台 Connecter 的 `relay.json` → `pets[].token`（找管理员要）
   - `group` / `agent`：与该中继上的群/Agent 及 runner binding 一致（当前 ECS 灰度群「灰度测试」/ Cursor Agent）
   - `live2d.modelUrl`：应用本地 `model3.json` 路径；`scale` 是自动适配后的倍率，位置可按模型微调
3. 可选（小爱完成播报，经 linlisHomePage，**不经 Connecter**）：

   | 字段 | 含义 |
   |------|------|
   | `xiaoaiAnnounce` | `true` 时，本宠发出的 Agent run 进入终态（`completed` / `failed` / `error` / `delivered`）后 POST homepage 播报；默认 `false` |
   | `homepageBaseUrl` | homepage API 根，如 `http://127.0.0.1:8000` |
   | `homepagePetToken` | 与 homepage 服务端 `XIAOMI_PET_TOKEN` 相同（占位符见 `config.example.json`，勿提交真实 token） |

   桌宠顶栏与展开面板均有「小爱播报」开关；切换会写 `localStorage` 并经 Tauri 回写 `xiaoaiAnnounce`。homepage 侧 `announceEnabled` 仍是总闸（关则 200 skipped、不 TTS）。缺 URL 或 token 时打开开关会气泡提示，不发请求。
4. 缺 Connecter 配置时应用会提示，不会静默连任何后端

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

- 右键角色 → 形象菜单：Live2D / 状态动图、更换当前模式的模型或皮肤、上传文件夹（持久化到 `~/.workpet/config.json` 的 `pet.mode`）
- 状态动图：右键「复制定制 prompt」复制四文件 zip 说明，到任意生图站贴上并附参考图；「加载压缩包…」把 zip 解到 `~/.workpet/skins/`（`idle|thinking|speaking|error` + gif/webp/png/svg）。WorkPet 不调用生图 API。
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
