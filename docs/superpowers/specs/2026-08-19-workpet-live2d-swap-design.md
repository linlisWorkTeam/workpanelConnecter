# WorkPet 形象加载：Live2D / 状态动图 — 设计稿

> 文档状态：已实现的设计记录；当前使用说明见 `apps/workpet/README.md`。

> 日期：2026-08-19  
> 状态：**已批准（双模式）**  
> 相关：`docs/workpet-live2d-design.md` · 本文取代仅 Live2D 换模的交互描述

## 1. 已锁定决策

| # | 决策 |
|---|------|
| S1 | 桌面常驻宠；**不在** CONNECTED SPACE 面板换形象 |
| S2 | **右键点角色**出菜单；左键仍互动 / 打开聊天 |
| S3 | **两种加载模式**：`live2d`（Cubism）与 `sprite`（按状态循环动图） |
| S4 | 模式与当前皮肤写入 `~/.workpet/config.json`，下次启动仍用 |
| S5 | 动图皮肤目录：`idle` / `thinking` / `speaking` / `error` 各一张（webp/png/gif/svg）；缺的回退 `idle` |
| S6 | 上传选文件夹，拷到 `~/.workpet/skins/<name>/`（动图）或 `~/.workpet/models/<name>/`（Live2D） |
| S7 | 自带 Live2D = 应用 `models/`；自带动图 = 现有 `skin.svg` |
| S8 | 禁止远程 URL 与 `..`；换形象与登录无关 |
| S9 | 加载失败：动图回退默认剪影；Live2D 回退 Hiyori 或剪影；聊天不受影响 |

## 2. 右键菜单

```text
右键角色
├─ 形象 · Live2D          ● 当前模式
├─ 形象 · 状态动图
├─ 更换…                 （子菜单：当前模式下的皮肤/模型）
└─ 上传…
```

「上传」随当前模式：Live2D 要含 `.model3.json` 的文件夹；动图要含至少一张 `idle.*`（或任一状态文件，则四态共用）。状态动图另有「复制定制 prompt / 加载压缩包」，见 `2026-08-19-workpet-sprite-customize-design.md`。

## 3. 配置

```json
{
  "pet": {
    "mode": "live2d",
    "spriteSkin": "default"
  },
  "live2d": { "modelUrl": "models/hiyori/Hiyori.model3.json" }
}
```

`set_config` 对对象字段 **深合并**，避免只改 `mode` 时冲掉 `live2d.motions`。
