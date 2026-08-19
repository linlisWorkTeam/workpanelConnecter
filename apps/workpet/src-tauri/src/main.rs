// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

/// 读取 ~/.workpet/config.json（WorkPet 桌面配置）
#[tauri::command]
fn get_config() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home dir".to_string())?;
    let path: PathBuf = home.join(".workpet").join("config.json");
    std::fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))
}

/// 合并写入 ~/.workpet/config.json（patch 为 JSON object 字符串）
#[tauri::command]
fn set_config(patch: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home dir".to_string())?;
    let dir = home.join(".workpet");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let mut root = serde_json::Map::new();
    if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&raw) {
            root = map;
        }
    }
    let incoming: serde_json::Value =
        serde_json::from_str(&patch).map_err(|e| format!("invalid json: {e}"))?;
    if let serde_json::Value::Object(map) = incoming {
        for (k, v) in map {
            root.insert(k, v);
        }
    } else {
        return Err("patch must be object".into());
    }
    let out = serde_json::Value::Object(root);
    std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap() + "\n")
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
