// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sprite_zip;

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn workpet_home() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home dir".to_string())?;
    Ok(home.join(".workpet"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(workpet_home()?.join("config.json"))
}

fn deep_merge(dest: &mut Value, patch: &Value) {
    match (dest, patch) {
        (Value::Object(d), Value::Object(p)) => {
            for (k, v) in p {
                if d.get(k).map(|cur| cur.is_object() && v.is_object()).unwrap_or(false) {
                    deep_merge(d.get_mut(k).unwrap(), v);
                } else {
                    d.insert(k.clone(), v.clone());
                }
            }
        }
        (d, p) => *d = p.clone(),
    }
}

fn sanitize_id(raw: &str) -> Option<String> {
    let name = Path::new(raw)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(raw);
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    if !name
        .chars()
        .next()
        .map(|c| c.is_ascii_alphanumeric())
        .unwrap_or(false)
    {
        return None;
    }
    if name.len() > 64 {
        return None;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return None;
    }
    Some(name.to_string())
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn find_model3(dir: &Path) -> Option<PathBuf> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let Ok(rd) = fs::read_dir(&cur) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_ascii_lowercase().ends_with(".model3.json"))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

const STATES: [&str; 4] = ["idle", "thinking", "speaking", "error"];
const IMG_EXTS: [&str; 4] = ["webp", "png", "gif", "svg"];

fn sprite_frame(dir: &Path, state: &str) -> Option<PathBuf> {
    for ext in IMG_EXTS {
        let p = dir.join(format!("{state}.{ext}"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn sprite_frames(dir: &Path) -> HashMap<String, String> {
    let idle = STATES
        .iter()
        .find_map(|s| sprite_frame(dir, s))
        .or_else(|| sprite_frame(dir, "idle"));
    let mut out = HashMap::new();
    for state in STATES {
        let path = sprite_frame(dir, state).or_else(|| idle.clone());
        if let Some(p) = path {
            out.insert(state.to_string(), p.to_string_lossy().to_string());
        }
    }
    out
}

#[derive(Serialize)]
struct SkinItem {
    id: String,
    label: String,
    source: String,
    frames: HashMap<String, String>,
}

#[derive(Serialize)]
struct ModelItem {
    id: String,
    label: String,
    source: String,
    model_url: String,
    abs_path: Option<String>,
}

#[tauri::command]
fn get_config() -> Result<String, String> {
    let path = config_path()?;
    fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))
}

#[tauri::command]
fn set_config(patch: String) -> Result<(), String> {
    let dir = workpet_home()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let mut root = Value::Object(Map::new());
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
            root = parsed;
        }
    }
    let incoming: Value =
        serde_json::from_str(&patch).map_err(|e| format!("invalid json: {e}"))?;
    if !incoming.is_object() {
        return Err("patch must be object".into());
    }
    deep_merge(&mut root, &incoming);
    fs::write(&path, serde_json::to_string_pretty(&root).unwrap() + "\n")
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sprite_skins() -> Result<Vec<SkinItem>, String> {
    let mut items = vec![SkinItem {
        id: "default".into(),
        label: "默认剪影".into(),
        source: "bundled".into(),
        frames: HashMap::new(),
    }];
    let dir = workpet_home()?.join("skins");
    if !dir.is_dir() {
        return Ok(items);
    }
    let mut extras = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(id) = sanitize_id(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let frames = sprite_frames(&entry.path());
        if frames.is_empty() {
            continue;
        }
        extras.push(SkinItem {
            id: id.clone(),
            label: id,
            source: "user".into(),
            frames,
        });
    }
    extras.sort_by(|a, b| a.id.cmp(&b.id));
    items.extend(extras);
    Ok(items)
}

#[tauri::command]
async fn import_sprite_skin() -> Result<Option<SkinItem>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("选择动图文件夹（idle/thinking/speaking/error）")
        .pick_folder()
        .await;
    let Some(handle) = folder else {
        return Ok(None);
    };
    let src = handle.path().to_path_buf();
    let frames = sprite_frames(&src);
    if frames.is_empty() {
        return Err("文件夹里没有 idle/thinking/speaking/error 的 webp、png、gif 或 svg".into());
    }
    let raw_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("skin");
    let id = sanitize_id(raw_name).unwrap_or_else(|| "skin".into());
    let dest = workpet_home()?.join("skins").join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for ext in IMG_EXTS {
        for state in STATES {
            let from = src.join(format!("{state}.{ext}"));
            if from.is_file() {
                fs::copy(&from, dest.join(format!("{state}.{ext}"))).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(Some(SkinItem {
        id: id.clone(),
        label: id,
        source: "user".into(),
        frames: sprite_frames(&dest),
    }))
}

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
    let bak = skins.join(format!(".bak-{id}"));
    // Orphan bak with missing dest: restore first; never delete bak while dest is gone.
    if !dest.exists() && bak.exists() {
        fs::rename(&bak, &dest).or_else(|_| {
            copy_dir(&bak, &dest)?;
            fs::remove_dir_all(&bak).map_err(|e| e.to_string())
        })?;
    }
    // Only drop leftover bak when dest already exists as the live skin.
    if bak.exists() && dest.exists() {
        fs::remove_dir_all(&bak).map_err(|e| e.to_string())?;
    }
    if dest.exists() {
        if let Err(err) = fs::rename(&dest, &bak).map_err(|e| e.to_string()) {
            let _ = fs::remove_dir_all(&tmp);
            return Err(err);
        }
    }
    let promote = fs::rename(&tmp, &dest).or_else(|_| {
        copy_dir(&tmp, &dest)?;
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())
    });
    if let Err(err) = promote {
        let _ = fs::remove_dir_all(&tmp);
        if bak.exists() {
            if dest.exists() {
                let _ = fs::remove_dir_all(&dest);
            }
            if let Err(restore_err) = fs::rename(&bak, &dest).or_else(|_| {
                copy_dir(&bak, &dest)?;
                fs::remove_dir_all(&bak).map_err(|e| e.to_string())
            }) {
                return Err(restore_err);
            }
        }
        return Err(err);
    }
    if bak.exists() && dest.exists() {
        let _ = fs::remove_dir_all(&bak);
    }
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

#[tauri::command]
fn list_live2d_models() -> Result<Vec<ModelItem>, String> {
    let mut items = vec![ModelItem {
        id: "hiyori".into(),
        label: "Hiyori".into(),
        source: "bundled".into(),
        model_url: "models/hiyori/Hiyori.model3.json".into(),
        abs_path: None,
    }];
    let dir = workpet_home()?.join("models");
    if !dir.is_dir() {
        return Ok(items);
    }
    let mut extras = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(id) = sanitize_id(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let Some(model) = find_model3(&entry.path()) else {
            continue;
        };
        extras.push(ModelItem {
            id: id.clone(),
            label: id,
            source: "user".into(),
            model_url: String::new(),
            abs_path: Some(model.to_string_lossy().to_string()),
        });
    }
    extras.sort_by(|a, b| a.id.cmp(&b.id));
    items.extend(extras);
    Ok(items)
}

#[tauri::command]
async fn import_live2d_model() -> Result<Option<ModelItem>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("选择 Live2D 文件夹（含 .model3.json）")
        .pick_folder()
        .await;
    let Some(handle) = folder else {
        return Ok(None);
    };
    let src = handle.path().to_path_buf();
    let Some(model) = find_model3(&src) else {
        return Err("文件夹里没有 .model3.json".into());
    };
    let raw_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("model");
    let id = sanitize_id(raw_name).unwrap_or_else(|| "model".into());
    let dest = workpet_home()?.join("models").join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    copy_dir(&src, &dest)?;
    let stored = find_model3(&dest).unwrap_or(dest.join(model.file_name().unwrap()));
    Ok(Some(ModelItem {
        id: id.clone(),
        label: id,
        source: "user".into(),
        model_url: String::new(),
        abs_path: Some(stored.to_string_lossy().to_string()),
    }))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            list_sprite_skins,
            import_sprite_skin,
            import_sprite_zip,
            write_sprite_customize_prompt,
            list_live2d_models,
            import_live2d_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
