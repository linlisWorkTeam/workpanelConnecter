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
    let mut remaining = MAX_UNCOMPRESSED;
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
        let mut out_file = match File::create(&out) {
            Ok(f) => f,
            Err(e) => {
                cleanup(dest);
                return Err(e.to_string());
            }
        };
        let limit = remaining;
        let n = {
            let mut limited = (&mut entry).take(limit);
            match io::copy(&mut limited, &mut out_file) {
                Ok(n) => n,
                Err(e) => {
                    cleanup(dest);
                    return Err(e.to_string());
                }
            }
        };
        if n == limit {
            let mut probe = [0u8; 1];
            match entry.read(&mut probe) {
                Ok(0) => {}
                Ok(_) => {
                    cleanup(dest);
                    return Err("压缩包过大".into());
                }
                Err(e) => {
                    cleanup(dest);
                    return Err(e.to_string());
                }
            }
        }
        remaining = remaining.saturating_sub(n);
        extracted += 1;
    }
    if extracted == 0 {
        cleanup(dest);
        return Err("压缩包里没有 idle/thinking/speaking/error 的 gif、webp、png 或 svg".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
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
        match extract_sprite_zip(&zip_path, &dest) {
            Err(err) => assert!(err.contains("非法路径")),
            Ok(()) => {
                // zip crate may normalize ../ away; must not escape dest
                assert!(!dir.join("idle.gif").exists());
            }
        }
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
