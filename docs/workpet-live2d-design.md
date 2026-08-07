# WorkPet Live2D 改造设计

> 日期：2026-08-07  
> 状态：已实现并通过 Windows / WebView2 验收  
> 范围：`apps/workpet` 桌面端；Connecter API 与路由协议不变

## 1. 目标

把现有 120×120 静态 SVG 猫猫球替换为真正的 Live2D Cubism 模型，同时保留透明、无边框、置顶的 Tauri 2 桌面窗口和现有聊天能力。

本次完成后：

- 桌面态显示可眨眼、呼吸、随指针轻微转头的 Live2D 角色；
- `idle`、`thinking`、`speaking`、`error` 四种业务状态可驱动动作或表情；
- 点击角色触发互动动作，点击聊天按钮展开面板；展开后角色不会被面板完全遮住；
- 模型、Cubism Core 或 WebGL 加载失败时，仍可使用静态降级角色和聊天；
- Connecter 的鉴权、消息、run 轮询协议保持不变。

## 2. 非目标

- 本期不做摄像头面捕、麦克风口型、模型编辑器或模型市场；
- 不允许在应用内任意安装不受信任的模型包；
- 不改变 Connecter、WorkPanel 的 API、部署和鉴权边界；
- 不把 Live2D 渲染逻辑写进 Connecter SDK。

## 3. 技术决策

| 编号 | 决策 |
|---|---|
| L1 | 在 Tauri 2 的 WebView2/WebKit WebView 中使用 WebGL 渲染 Cubism `model3.json` 模型。 |
| L2 | UI 通过独立 `Live2DPet` 适配层控制模型，聊天代码只发送语义状态，不依赖具体模型动作名。 |
| L3 | 首版采用浏览器侧 Pixi 渲染适配；Cubism Core、模型和动作文件均从应用本地资源加载，不使用运行时 CDN。 |
| L4 | `live2d.modelUrl`、缩放、位置和状态动作映射进入本地配置；默认模型路径固定在应用资源目录。 |
| L5 | 模型包必须包含来源和许可说明。Cubism Core 受 Live2D Proprietary Software License 约束；官方样例模型另受 Free Material License 与模型条款约束。发布应用前由发布主体复核并完成所需授权。 |
| L6 | 渲染失败自动切换静态 SVG 降级层；失败只影响角色动画，不阻断聊天。 |
| L7 | 收起态窗口为 300×420，展开态为 440×680；窗口仍透明、无边框、不可调整大小。 |
| L8 | 默认不把角色整个区域设为系统拖拽区。仅顶部拖拽柄用于移动窗口，按钮、输入框和模型点击保持可交互。 |
| L9 | 桌宠尺寸支持 75%～150% 分级调整；收起态同步缩放窗口和角色，聊天展开态保持 440×680 可读尺寸，并在本机持久化选择。 |

选择浏览器侧适配的原因：它能复用 Tauri WebView、透明窗口和现有纯前端代码，不引入第二套原生渲染窗口；渲染层与 Connecter SDK 之间也能保持清晰边界。

## 4. 组件结构

```text
Tauri window
└─ WorkPet UI
   ├─ Live2DPet renderer
   │  ├─ Canvas / WebGL
   │  ├─ Cubism runtime + model pack
   │  └─ SVG fallback
   ├─ Pet state controller
   │  └─ idle / thinking / speaking / error
   └─ Chat controller
      └─ ConnecterClient → /v1/chat, /v1/messages, /v1/runs
```

约束：`connecterApi.js` 继续是无 UI 依赖的通信 SDK；`live2dPet.js` 不发送网络请求；`main.js` 负责把业务状态桥接给二者。

## 5. 状态与动作映射

| 业务状态 | 视觉反馈 | 默认动作策略 |
|---|---|---|
| `idle` | 呼吸、眨眼、轻微跟随指针 | 播放模型 `Idle` 组中的随机动作 |
| `thinking` | 状态灯变暖色、轻微上下浮动 | 保持 Idle，并增加 UI 层浮动；若配置了 `Thinking` 则优先播放 |
| `speaking` | 对方消息出现时角色短暂回应 | 播放 `TapBody` 或配置的 `Speaking` 动作 |
| `error` | 状态灯变红、角色降低饱和度 | 停止额外动作；若配置了 `Error` 则播放一次 |

动作组不存在不是错误；适配层应回退到 `Idle`。点击模型优先播放 `TapBody`；聊天由独立按钮展开。

## 6. 配置

在现有 `~/.workpet/config.json` 中新增可选字段：

```json
{
  "ui": {
    "petScale": 1.0
  },
  "live2d": {
    "modelUrl": "models/hiyori/Hiyori.model3.json",
    "scale": 1.0,
    "offsetX": 0,
    "offsetY": 8,
    "motions": {
      "idle": "Idle",
      "thinking": "Idle",
      "speaking": "TapBody",
      "error": "Idle"
    }
  }
}
```

`scale` 是自动适配窗口后的模型倍率（`1.0` 为完整角色适配），不是模型原始像素缩放值。窗口尺寸还可用 `ui.petScale` 指定初始倍率；用户通过界面调整后，本机保存值在后续启动时优先。界面提供 `A−` / `A+`，快捷键为 `Ctrl+-` / `Ctrl++`。

相对 URL 只从应用打包资源中解析。远程 HTTP 模型默认不支持，避免模型文件被替换或加载混合内容。

## 7. 资源与许可边界

仓库中的第三方资源必须附带：

1. 来源 URL、版本或提交号；
2. 原始许可/Notice；
3. 是否允许再分发以及发布前检查项；
4. 模型文件的固定目录，不与业务代码混放。

开发阶段可以使用 Live2D 官方样例模型验证，但不能把“可开发”理解成“可直接商业发布”。如果发布主体不采用样例模型，替换为自有授权的 `model3.json` 模型即可，业务代码无需变化。

## 8. 失败降级

| 故障 | 行为 |
|---|---|
| WebGL 不可用 | 显示 SVG 降级角色，聊天继续可用 |
| Cubism Core 未安装 | 显示明确的“Live2D 资源未就绪”提示和 SVG 降级角色 |
| 模型或纹理加载失败 | 记录具体资源路径，显示降级角色，不无限重试 |
| Connecter 配置缺失 | Live2D 仍可显示；聊天区提示配置缺失 |
| Connecter 请求失败 | 切换 `error` 状态；允许继续打开面板与重试 |

## 9. 验收标准

- `npm run build:ui` 可离线构建前端；
- `npm run test:ui` 覆盖配置合并、状态降级和模型路径校验；
- `cargo check` 与 `npm run tauri build -- --debug` 通过；
- Windows 桌面实测透明背景、置顶、拖拽柄、收起/展开尺寸正确；
- Live2D 模型能渲染并播放 Idle/点击动作；
- 缺少模型或 Core 时静态降级可见，聊天 UI 不崩溃；
- README 写清资源准备、运行命令、许可检查和常见失败原因。
