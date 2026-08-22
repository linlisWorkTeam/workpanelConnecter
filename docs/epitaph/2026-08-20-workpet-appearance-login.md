---
date: 2026-08-20
topic: workpet-appearance-login
branch: main
status: active
---

# Epitaph: WorkPet 登录 + Live2D/状态动图定制

> 文档状态：2026-08-20 session 交接快照；其中跨站联邦未完成的表述已被 v0.2.0+ 取代。

> 先读本文，再读 [2026-08-19-workpet-connected-space](./2026-08-19-workpet-connected-space.md)（群控制台 / Host 命名 / 槽位 follow-up）。

## Built this session

- Connecter **匿名** `POST /v1/auth/login`（在 bearer 鉴权之前）；登录 overlay `sessionWpAuth` 优先于 `pets[].wpAuth`。
- WorkPet CONNECTED SPACE 未登录锁定；群/消息仅自己所在群（`NOT_IN_GROUP`）。
- 本环境 Connecter 出站会合 Host（`hostJoin` / `hostPeers`）；WP 槽位 `wpSlots` + `npm run wp-slot`。
- WorkPet **两种形象**：`live2d` / `sprite`。右键角色切模式、换皮肤、上传文件夹。配置深合并进 `~/.workpet/config.json`。
- 状态动图 **定制**：复制固定 prompt；加载四文件 zip（`idle|thinking|speaking|error` + gif/webp/png/svg）到 `~/.workpet/skins/`。不接生图 API。

## Key paths

- 登录：`src/relay/server.js` · `src/relay/sessionWpAuth.js` · `apps/workpet/ui/connecterApi.js` · `apps/workpet/ui/main.js`
- 形象：`apps/workpet/ui/petAppearanceMenu.js` · `spritePet.js` · `spriteCustomizePrompt.js` · `src-tauri/src/sprite_zip.rs` · `src-tauri/src/main.rs`
- 规格：`docs/superpowers/specs/2026-08-19-workpet-live2d-swap-design.md` · `docs/superpowers/specs/2026-08-19-workpet-sprite-customize-design.md`
- 计划：`docs/superpowers/plans/2026-08-19-workpet-sprite-customize.md`

## Locked product decisions

- UI 只叫 **WorkPet**；每站一台 **Connecter**；全网一台 **Connecter Host**。
- 形象不在 CONNECTED SPACE 面板换；右键角色。上传进用户目录，不进安装目录 `ui/models/`。
- 定制 zip 与文件夹皮肤同一契约；缺态回退 idle。换形象与登录无关。
- WorkPet 不调用任何生图平台。

## Known pitfalls

- `network: Failed to fetch` = 本机 Connecter `:9080` 没起来，不是密码错。先 `npm run relay` 再登录。旧中继进程没有 `/v1/auth/login` 会变成 `missing bearer token`。
- 登录 overlay **只在中继内存**；重启 `npm run relay` 后桌宠要重新登录。
- 登录用的是 **当前环境 WorkPanel** 用户名密码（灰度多为 `:8082`），不是 `pets[].token`。
- 不要用 PowerShell `ConvertTo-Json` 回写 `~/.workpet/config.json`（编码/形状易导致 serde 解析失败，`set_config` 会把文件写成只剩一小块 patch）。
- `~/.workpet/config.json` ≠ 仓库 `apps/workpet/ui/config.json`。勿把真实 token 提交进 git。
- 右键菜单在矮窗里可能贴底被裁；点角色中上部再右键。
- **不要** `stash pop`：`wip-e1-before-e2-merge`、`wip-capabilities-schema`。

## How to run / verify

```text
npm run relay
cd apps/workpet && npm run dev
cd apps/workpet && npm run test:ui
cd apps/workpet/src-tauri && cargo test
npm run test:pet-login
```

冒烟：右键切「状态动图」→ 复制定制 prompt →（外部生图出 zip）→ 加载压缩包；重启后皮肤仍在。登录后才能看群。

## Do not regress

- `/v1/auth/login` 必须在 bearer 鉴权之前。
- `set_config` 对对象字段深合并，避免只改 `pet.mode` 冲掉 `live2d.motions`。
- zip 拒绝 `..` / 绝对路径；未压缩 ≤32MB；条目 ≤32；失败不改当前皮肤文件（bak/restore）。
- Live2D 模式菜单不出现定制两项；文件夹上传保留。

## Open follow-ups

- 菜单在 300×420 窗内贴底裁切，可再调定位。
- 中文 zip 文件名会被 `sanitize_id` 收成 `skin`，重名覆盖。
- 跨站消息联邦、E3/E4 仍未做。WP 仓尚未内嵌槽位自注册（见上一篇墓志铭）。
