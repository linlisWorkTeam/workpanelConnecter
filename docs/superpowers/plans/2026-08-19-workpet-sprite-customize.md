# WorkPet 状态动图「定制」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 状态动图模式可复制固定定制 prompt，并加载符合四文件约定的 zip 皮肤；WorkPet 不调用任何生图 API。

**Architecture:** Prompt 是前端常量。复制走 `navigator.clipboard`，失败则 Tauri 写入 `~/.workpet/sprite-customize-prompt.txt`。zip 在 Rust 里解到临时目录、校验后再进 `~/.workpet/skins/<id>/`，之后复用现有 `list_sprite_skins` / `sprite_frames`。菜单只在 `mode === 'sprite'` 时多两项。

**Tech Stack:** WorkPet 前端 ES module + node:test；Tauri 2；`zip` crate；`rfd` 选文件。

## Global Constraints

- 不接、不内置任何生图平台；不把参考图上传到任何服务器。
- zip 契约与文件夹皮肤相同：`idle|thinking|speaking|error` + `gif|webp|png|svg`；缺的回退 idle。
- 「上传动图文件夹…」保留；Live2D 模式不出现定制两项。
- 拒绝 `..` / 绝对路径；未压缩总量 ≤32MB；zip 条目 ≤32。
- 失败只 `showBubble`，不改 `pet.spriteSkin`、不影响聊天。
- 换形象与登录无关。
- 执行时 **不要 commit**，除非用户当场要求提交（本仓 git 规则优先于计划里的 Commit 步；无授权则跳过该步）。
- `cd apps/workpet && npm run test:ui` 与 `cd apps/workpet/src-tauri && cargo test` 必须绿。

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/workpet/ui/spriteCustomizePrompt.js` | `SPRITE_CUSTOMIZE_PROMPT` 常量（规格第 4 节全文） |
| `apps/workpet/tests/spriteCustomize.test.mjs` | prompt 含四态与 `.zip` |
| `apps/workpet/ui/petAppearanceMenu.js` | sprite 模式追加复制 / 加载 zip |
| `apps/workpet/tests/petAppearance.test.mjs` | 菜单两项仅 sprite 出现 |
| `apps/workpet/src-tauri/src/sprite_zip.rs` | 解包、限额、路径穿越 |
| `apps/workpet/src-tauri/src/main.rs` | `import_sprite_zip`、`write_sprite_customize_prompt` |
| `apps/workpet/src-tauri/Cargo.toml` | `zip = "2"` |
| `apps/workpet/ui/main.js` | 菜单点击：复制 prompt / 加载 zip |
| `apps/workpet/package.json` | `test:ui` 纳入新测试文件 |
| `apps/workpet/README.md` | 一句定制说明 |
| `docs/superpowers/specs/2026-08-19-workpet-sprite-customize-design.md` | 状态改为已批准 |

---

### Task 1: Prompt 常量

**Files:**
- Create: `apps/workpet/ui/spriteCustomizePrompt.js`
- Create: `apps/workpet/tests/spriteCustomize.test.mjs`
- Modify: `apps/workpet/package.json`（`test:ui` 脚本）

**Interfaces:**
- Consumes: 无
- Produces: `export const SPRITE_CUSTOMIZE_PROMPT`（string，规格第 4 节原文，含末尾换行）

- [ ] **Step 1: Write the failing test**

Create `apps/workpet/tests/spriteCustomize.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRITE_CUSTOMIZE_PROMPT } from '../ui/spriteCustomizePrompt.js';

test('customize prompt names the four sprite files and a zip', () => {
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bidle\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bthinking\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\bspeaking\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\berror\b/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /\.zip/);
  assert.match(SPRITE_CUSTOMIZE_PROMPT, /参考图/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/workpet && node --test tests/spriteCustomize.test.mjs`

Expected: FAIL（`ERR_MODULE_NOT_FOUND` for `spriteCustomizePrompt.js`）

- [ ] **Step 3: Write minimal implementation**

Create `apps/workpet/ui/spriteCustomizePrompt.js` with this exact string (keep Chinese punctuation):

```js
export const SPRITE_CUSTOMIZE_PROMPT = `你是桌宠皮肤打包助手。用户会附带一张参考图（自拍或立绘）。请严格按该图的脸、发型、服饰，生成一只可做桌面宠物的角色，并打成一个 .zip。

硬性要求：
1. zip 根目录（或只套一层文件夹）必须包含以下小写文件名，优先用循环动图：
   - idle.gif（或 .webp / .png）：待机，轻微呼吸或眨眼
   - thinking.gif：思考，例如歪头、看向一侧
   - speaking.gif：说话，口型或身体轻晃
   - error.gif：出错，愣住或冒汗，不要恐怖、不要流血
2. 透明背景；角色完整入画；不要边框、水印、字幕、四宫格或精灵表。
3. 四张必须是同一只角色、同一套衣服、同一构图（全身或半身保持一致）。画布 512×512 或 768×768。
4. 每段动图约 1–2 秒循环。不要只给一张预览图。
5. 不要 README 或其它文件名。缺文件会导致桌宠无法加载。

只输出这一个可下载的 zip。
`;
```

In `apps/workpet/package.json`, change `test:ui` to:

```json
"test:ui": "node --test tests/petConfig.test.mjs tests/connecterApi.test.mjs tests/petStamp.test.mjs tests/xiaoaiAnnounce.test.mjs tests/petAppearance.test.mjs tests/spriteCustomize.test.mjs"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/workpet && npm run test:ui`

Expected: all tests pass, including `customize prompt names the four sprite files and a zip`

- [ ] **Step 5: Commit**

Skip unless the user asked to commit.

```bash
git add apps/workpet/ui/spriteCustomizePrompt.js apps/workpet/tests/spriteCustomize.test.mjs apps/workpet/package.json
git commit -m "feat(workpet): add sprite customize prompt constant"
```

---

### Task 2: 右键菜单两项（仅 sprite）

**Files:**
- Modify: `apps/workpet/ui/petAppearanceMenu.js`
- Modify: `apps/workpet/tests/petAppearance.test.mjs`

**Interfaces:**
- Consumes: 现有 `buildAppearanceMenu({ mode, live2dItems, spriteItems, currentModelUrl, currentSkin })`
- Produces: sprite 模式在 `upload` 之后追加 `{ id: 'copy-prompt', label: '复制定制 prompt' }` 与 `{ id: 'load-zip', label: '加载压缩包…' }`；live2d 模式没有这两项。`upload` 仍存在。

- [ ] **Step 1: Write the failing test**

Append to `apps/workpet/tests/petAppearance.test.mjs`:

```js
test('sprite menu adds copy prompt and load zip; live2d does not', () => {
  const sprite = buildAppearanceMenu({
    mode: 'sprite',
    currentSkin: 'default',
    currentModelUrl: 'models/hiyori/Hiyori.model3.json',
    live2dItems: [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }],
    spriteItems: [{ id: 'default', label: '默认剪影' }],
  });
  assert.equal(sprite.find((r) => r.id === 'copy-prompt').label, '复制定制 prompt');
  assert.equal(sprite.find((r) => r.id === 'load-zip').label, '加载压缩包…');
  assert.ok(sprite.find((r) => r.id === 'upload'));

  const live2d = buildAppearanceMenu({
    mode: 'live2d',
    currentSkin: 'default',
    currentModelUrl: 'models/hiyori/Hiyori.model3.json',
    live2dItems: [{ id: 'hiyori', label: 'Hiyori', modelUrl: 'models/hiyori/Hiyori.model3.json' }],
    spriteItems: [{ id: 'default', label: '默认剪影' }],
  });
  assert.equal(live2d.find((r) => r.id === 'copy-prompt'), undefined);
  assert.equal(live2d.find((r) => r.id === 'load-zip'), undefined);
  assert.ok(live2d.find((r) => r.id === 'upload'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/workpet && node --test tests/petAppearance.test.mjs`

Expected: FAIL — `sprite.find((r) => r.id === 'copy-prompt')` is undefined

- [ ] **Step 3: Write minimal implementation**

Replace the return array end of `buildAppearanceMenu` in `apps/workpet/ui/petAppearanceMenu.js` so the last items are:

```js
    { id: 'sep-2', separator: true },
    item({ id: 'upload', label: live2d ? '上传 Live2D 文件夹…' : '上传动图文件夹…' }),
    ...(live2d
      ? []
      : [
          item({ id: 'copy-prompt', label: '复制定制 prompt' }),
          item({ id: 'load-zip', label: '加载压缩包…' }),
        ]),
  ];
```

Keep the function signature and earlier rows unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/workpet && npm run test:ui`

Expected: PASS，含新菜单测试

- [ ] **Step 5: Commit**

Skip unless the user asked to commit.

---

### Task 3: zip 解包（Rust 单测）

**Files:**
- Create: `apps/workpet/src-tauri/src/sprite_zip.rs`
- Modify: `apps/workpet/src-tauri/src/main.rs`（加 `mod sprite_zip;`）
- Modify: `apps/workpet/src-tauri/Cargo.toml`（`zip = "2"`）

**Interfaces:**
- Consumes: 无 UI、无 `rfd`
- Produces:
  - `pub const MAX_UNCOMPRESSED: u64 = 32 * 1024 * 1024;`
  - `pub const MAX_ENTRIES: usize = 32;`
  - `pub fn extract_sprite_zip(zip_path: &Path, dest: &Path) -> Result<(), String>`
    - 成功：把合法四态文件以**小写**文件名写到 `dest` 根目录
    - 失败错误字符串（精确）：
      - `"不是有效的 zip"`
      - `"压缩包条目过多"`
      - `"压缩包过大"`
      - `"压缩包含非法路径"`
      - `"压缩包里没有 idle/thinking/speaking/error 的 gif、webp、png 或 svg"`

解包规则（全部在 `extract_sprite_zip` 内）：

1. 打开失败或 `ZipArchive::new` 失败 → `"不是有效的 zip"`。
2. `archive.len() > 32` → `"压缩包条目过多"`（在解任何文件之前）。
3. 先扫一遍：对每个非目录条目把 `entry.size()`（未压缩大小）累加，超过 `32 * 1024 * 1024` → `"压缩包过大"`。
4. 再扫一遍写入：`enclosed_name()` 为 `None` 或路径 `is_absolute()` → `"压缩包含非法路径"`（整包拒绝，并删掉已写入的 `dest`）。
5. 只处理 1 或 2 个 `Normal` 路径分量（根文件，或一层文件夹 + 文件）。更深的忽略。
6. 文件名（最后一段）转小写后匹配 `idle|thinking|speaking|error` + `gif|webp|png|svg` 才写入 `dest/{state}.{ext}`；其它文件忽略。
7. 写入完成后若一个四态文件都没有 → 删 `dest`，返回没有四态文件的错误。

- [ ] **Step 1: Add dependency and failing tests**

In `apps/workpet/src-tauri/Cargo.toml` under `[dependencies]`:

```toml
zip = "2"
```

Create `apps/workpet/src-tauri/src/sprite_zip.rs` with **only** the test module and a stub:

```rust
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

pub const MAX_UNCOMPRESSED: u64 = 32 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 32;

pub fn extract_sprite_zip(_zip_path: &Path, _dest: &Path) -> Result<(), String> {
    Err("not implemented".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "workpet-zip-{}-{}",
            std::process::id(),
            name
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in files {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn root_idle_gif_extracts() {
        let dir = tmp("root");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        write_zip(&zip_path, &[("idle.gif", b"GIF89a")]);
        extract_sprite_zip(&zip_path, &dest).unwrap();
        assert!(dest.join("idle.gif").is_file());
    }

    #[test]
    fn nested_folder_idle_extracts() {
        let dir = tmp("nest");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        write_zip(&zip_path, &[("skin/idle.webp", b"RIFF")]);
        extract_sprite_zip(&zip_path, &dest).unwrap();
        assert!(dest.join("idle.webp").is_file());
    }

    #[test]
    fn ignores_readme_and_still_loads() {
        let dir = tmp("readme");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        write_zip(
            &zip_path,
            &[("README.md", b"hi"), ("speaking.png", b"png")],
        );
        extract_sprite_zip(&zip_path, &dest).unwrap();
        assert!(dest.join("speaking.png").is_file());
        assert!(!dest.join("README.md").exists());
    }

    #[test]
    fn empty_zip_fails() {
        let dir = tmp("empty");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        write_zip(&zip_path, &[]);
        let err = extract_sprite_zip(&zip_path, &dest).unwrap_err();
        assert!(err.contains("没有 idle"));
    }

    #[test]
    fn zip_slip_rejected() {
        let dir = tmp("slip");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        write_zip(&zip_path, &[("../idle.gif", b"GIF89a")]);
        let err = extract_sprite_zip(&zip_path, &dest).unwrap_err();
        assert!(err.contains("非法路径"));
    }

    #[test]
    fn too_many_entries_rejected() {
        let dir = tmp("many");
        let zip_path = dir.join("pack.zip");
        let dest = dir.join("out");
        let files: Vec<(String, Vec<u8>)> = (0..33)
            .map(|i| (format!("n{i}.txt"), b"x".to_vec()))
            .collect();
        let owned: Vec<(&str, &[u8])> = files
            .iter()
            .map(|(n, b)| (n.as_str(), b.as_slice()))
            .collect();
        write_zip(&zip_path, &owned);
        let err = extract_sprite_zip(&zip_path, &dest).unwrap_err();
        assert!(err.contains("条目过多"));
    }
}
```

Add at the top of `apps/workpet/src-tauri/src/main.rs` after the existing `use` block:

```rust
mod sprite_zip;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/workpet/src-tauri && cargo test --lib extract_sprite_zip root_idle -- --nocapture`

If `--lib` 不匹配（这是 binary crate），改用：

Run: `cd apps/workpet/src-tauri && cargo test root_idle_gif_extracts`

Expected: FAIL — `not implemented` or test panic on `unwrap`

- [ ] **Step 3: Implement `extract_sprite_zip`**

Replace the stub in `sprite_zip.rs` with:

```rust
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path};

pub const MAX_UNCOMPRESSED: u64 = 32 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 32;

const STATES: [&str; 4] = ["idle", "thinking", "speaking", "error"];
const EXTS: [&str; 4] = ["gif", "webp", "png", "svg"];

fn sprite_name(file_name: &str) -> Option<(String, String)> {
    let lower = file_name.to_ascii_lowercase();
    let (stem, ext) = lower.rsplit_once('.')?;
    if STATES.contains(&stem) && EXTS.contains(&ext) {
        Some((stem.to_string(), ext.to_string()))
    } else {
        None
    }
}

fn cleanup(dest: &Path) {
    let _ = fs::remove_dir_all(dest);
}

pub fn extract_sprite_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|_| "不是有效的 zip".to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "不是有效的 zip".to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err("压缩包条目过多".into());
    }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        total = total.saturating_add(entry.size());
        if total > MAX_UNCOMPRESSED {
            return Err("压缩包过大".into());
        }
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut extracted = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(enclosed) = entry.enclosed_name() else {
            cleanup(dest);
            return Err("压缩包含非法路径".into());
        };
        if enclosed.is_absolute() {
            cleanup(dest);
            return Err("压缩包含非法路径".into());
        }
        let comps: Vec<_> = enclosed
            .components()
            .filter(|c| matches!(c, Component::Normal(_)))
            .collect();
        if comps.len() > 2 || comps.is_empty() {
            continue;
        }
        let file_name = comps
            .last()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("");
        let Some((state, ext)) = sprite_name(file_name) else {
            continue;
        };
        let out = dest.join(format!("{state}.{ext}"));
        let mut out_file = File::create(&out).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        extracted += 1;
    }
    if extracted == 0 {
        cleanup(dest);
        return Err("压缩包里没有 idle/thinking/speaking/error 的 gif、webp、png 或 svg".into());
    }
    Ok(())
}
```

Remove unused `use std::io::Read` if the compiler warns — keep `io::copy` only.

Keep the `#[cfg(test)]` module from Step 1 in the same file. Drop unused imports in the test helper (`Cursor` if unused).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/workpet/src-tauri && cargo test`

Expected: PASS，含 `root_idle_gif_extracts`、`nested_folder_idle_extracts`、`ignores_readme_and_still_loads`、`empty_zip_fails`、`zip_slip_rejected`、`too_many_entries_rejected`

If `zip_slip_rejected` 因 crate 把 `../idle.gif` 在 `start_file` 时就规范化而失败：改为断言 `extract` 要么 `Err` 含 `非法路径`，要么**没有**把文件写到 `dest` 的父目录；不得在 `dest` 之外创建 `idle.gif`。

- [ ] **Step 5: Commit**

Skip unless the user asked to commit.

---

### Task 4: Tauri 命令

**Files:**
- Modify: `apps/workpet/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `sprite_zip::extract_sprite_zip`；现有 `sanitize_id`、`workpet_home`、`sprite_frames`、`SkinItem`
- Produces:
  - `async fn import_sprite_zip() -> Result<Option<SkinItem>, String>`
    - 取消选文件 → `Ok(None)`
    - 成功 → `Ok(Some(SkinItem { id, label: id, source: "user", frames: sprite_frames(&dest) }))`
  - `fn write_sprite_customize_prompt(text: String) -> Result<String, String>`
    - 写入 `workpet_home()/sprite-customize-prompt.txt`，返回该路径字符串

- [ ] **Step 1: Register commands**

Add after `import_sprite_skin`:

```rust
#[tauri::command]
async fn import_sprite_zip() -> Result<Option<SkinItem>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("选择状态动图压缩包")
        .add_filter("zip", &["zip"])
        .pick_file()
        .await;
    let Some(handle) = picked else {
        return Ok(None);
    };
    let src = handle.path().to_path_buf();
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("skin");
    let id = sanitize_id(stem).unwrap_or_else(|| "skin".into());
    let skins = workpet_home()?.join("skins");
    fs::create_dir_all(&skins).map_err(|e| e.to_string())?;
    let tmp = skins.join(format!(".tmp-{id}"));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())?;
    }
    let extracted = crate::sprite_zip::extract_sprite_zip(&src, &tmp);
    if let Err(err) = extracted {
        let _ = fs::remove_dir_all(&tmp);
        return Err(err);
    }
    let dest = skins.join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &dest).or_else(|_| {
        copy_dir(&tmp, &dest)?;
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())
    })?;
    Ok(Some(SkinItem {
        id: id.clone(),
        label: id,
        source: "user".into(),
        frames: sprite_frames(&dest),
    }))
}

#[tauri::command]
fn write_sprite_customize_prompt(text: String) -> Result<String, String> {
    let dir = workpet_home()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("sprite-customize-prompt.txt");
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
```

Add both names to `generate_handler!`:

```rust
            import_sprite_skin,
            import_sprite_zip,
            write_sprite_customize_prompt,
            list_live2d_models,
            import_live2d_model
```

- [ ] **Step 2: Compile**

Run: `cd apps/workpet/src-tauri && cargo test`

Expected: PASS（无新单测也可；不能有 compile error）

- [ ] **Step 3: Commit**

Skip unless the user asked to commit.

---

### Task 5: 接到右键菜单

**Files:**
- Modify: `apps/workpet/ui/main.js`

**Interfaces:**
- Consumes: `SPRITE_CUSTOMIZE_PROMPT`；`tauriInvoke('import_sprite_zip')`；`tauriInvoke('write_sprite_customize_prompt', { text })`；现有 `persistAppearance` / `refreshAppearanceCatalogs` / `applyAppearance` / `showBubble`
- Produces: `pickAppearanceMenu('copy-prompt')` 与 `pickAppearanceMenu('load-zip')`

- [ ] **Step 1: Import prompt**

At the top of `apps/workpet/ui/main.js` with other UI imports:

```js
import { SPRITE_CUSTOMIZE_PROMPT } from './spriteCustomizePrompt.js';
```

- [ ] **Step 2: Handle the two menu ids**

Inside `pickAppearanceMenu`, **before** the `id === 'upload'` branch, insert:

```js
    if (id === 'copy-prompt') {
      try {
        await navigator.clipboard.writeText(SPRITE_CUSTOMIZE_PROMPT);
        showBubble('已复制。带上一张参考图，到任意生图平台按说明出 zip', 2800);
      } catch (_) {
        try {
          const path = await tauriInvoke('write_sprite_customize_prompt', {
            text: SPRITE_CUSTOMIZE_PROMPT,
          });
          showBubble(`复制失败，已写入 ${path}`, 3600);
        } catch (error) {
          showBubble(error.message || '复制 prompt 失败', 2400);
        }
      }
      return;
    }
    if (id === 'load-zip') {
      const imported = await tauriInvoke('import_sprite_zip');
      if (!imported) return;
      await refreshAppearanceCatalogs();
      await persistAppearance({ mode: 'sprite', spriteSkin: imported.id });
      await applyAppearance();
      showBubble('已换上新形象', 1800);
      return;
    }
```

Do not persist appearance if `import_sprite_zip` throws；外层已有 `catch` 会 `showBubble(error.message || '形象切换失败')`。

- [ ] **Step 3: Run UI tests**

Run: `cd apps/workpet && npm run test:ui`

Expected: PASS

- [ ] **Step 4: Commit**

Skip unless the user asked to commit.

---

### Task 6: 文档与规格状态

**Files:**
- Modify: `apps/workpet/README.md`（交互列表）
- Modify: `docs/superpowers/specs/2026-08-19-workpet-sprite-customize-design.md`（状态行）

**Interfaces:**
- Consumes: 已实现行为
- Produces: README 一句；规格 `状态：**已批准**`

- [ ] **Step 1: README**

In `apps/workpet/README.md` 交互列表，紧接右键菜单那条之后加：

```markdown
- 状态动图：右键「复制定制 prompt」复制四文件 zip 说明，到任意生图站贴上并附参考图；「加载压缩包…」把 zip 解到 `~/.workpet/skins/`（`idle|thinking|speaking|error` + gif/webp/png/svg）。WorkPet 不调用生图 API。
```

- [ ] **Step 2: Spec status**

Change the spec header line to:

```markdown
> 状态：**已批准**
```

- [ ] **Step 3: Final verification**

Run:

```bash
cd apps/workpet && npm run test:ui
cd apps/workpet/src-tauri && cargo test
```

Expected: both green.

- [ ] **Step 4: Commit**

Skip unless the user asked to commit.

---

## Spec coverage

| Spec | Task |
|------|------|
| C1 用户自备参考图 / 无模板 | Task 1 prompt 文案 |
| C2 四文件契约 | Task 3 解包 + 现有 sprite_frames |
| C3 菜单两项 + 保留文件夹上传 | Task 2 |
| C4 Live2D 不显示两项 | Task 2 |
| C5 解到 skins + 写 pet.mode/spriteSkin | Task 4–5 |
| C6 路径穿越 / 32MB / 32 条目 / 忽略其它文件 | Task 3 |
| C7 失败不改皮肤 | Task 5（throw 不 persist） |
| Prompt 正文 | Task 1 |
| 剪贴板失败写 txt | Task 4–5 |
| 非目标：无生图 API | 无对应实现任务 |

## 冒烟（实现后人工）

1. 重启 WorkPet。右键切到状态动图。
2. 「复制定制 prompt」→ 粘贴到记事本应是规格全文。
3. 做一个最小 zip（仅 `idle.gif`）→「加载压缩包」应变皮肤；重启后仍是该皮肤。
4. 空 zip 或乱文件名 → 气泡报错，形象不变。
5. Live2D 模式下菜单没有这两项。
