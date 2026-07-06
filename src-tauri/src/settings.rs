//! File-backed settings: `~/.config/smterm/settings.json` (`%APPDATA%\smterm\`
//! on Windows) is the source of truth. Rust just does file IO + a watcher that
//! emits `settings-changed` when the file changes; the frontend owns the schema.

use std::path::PathBuf;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Pure config-dir resolution (testable without touching the environment).
fn config_base(is_windows: bool, appdata: Option<String>, home: Option<String>) -> Option<PathBuf> {
    if is_windows {
        appdata.map(|a| PathBuf::from(a).join("smterm"))
    } else {
        home.map(|h| PathBuf::from(h).join(".config").join("smterm"))
    }
}

fn settings_path() -> Option<PathBuf> {
    let base = config_base(
        cfg!(target_os = "windows"),
        std::env::var("APPDATA").ok(),
        std::env::var("HOME").ok(),
    )?;
    Some(base.join("settings.json"))
}

/// Absolute path to settings.json (for display / opening).
#[tauri::command]
pub fn settings_file_path() -> String {
    settings_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Raw settings file contents, or "" if it doesn't exist (frontend → defaults).
#[tauri::command]
pub fn read_settings_file() -> String {
    match settings_path() {
        Some(p) => std::fs::read_to_string(p).unwrap_or_default(),
        None => String::new(),
    }
}

/// Write settings.json (creating parent dirs).
#[tauri::command]
pub fn write_settings_file(contents: String) -> Result<(), String> {
    let path = settings_path().ok_or("could not resolve settings path")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Watch settings.json and emit `settings-changed` on any edit.
pub fn start_watcher(app: AppHandle) {
    let Some(path) = settings_path() else {
        return;
    };
    let Some(dir) = path.parent().map(|p| p.to_path_buf()) else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let file_name = path.file_name().map(|f| f.to_os_string());

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(_) => return,
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }
        // Block forever, keeping `watcher` alive, emitting on our file's events.
        for event in rx.into_iter().flatten() {
            let touches = event
                .paths
                .iter()
                .any(|p| p.file_name().map(|f| f.to_os_string()) == file_name);
            if touches {
                let _ = app.emit("settings-changed", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::config_base;
    use std::path::PathBuf;

    #[test]
    fn unix_uses_dot_config() {
        assert_eq!(
            config_base(false, None, Some("/home/u".into())),
            Some(PathBuf::from("/home/u/.config/smterm"))
        );
    }

    #[test]
    fn windows_uses_appdata() {
        assert_eq!(
            config_base(true, Some("C:\\Users\\u\\AppData\\Roaming".into()), None),
            Some(PathBuf::from("C:\\Users\\u\\AppData\\Roaming").join("smterm"))
        );
    }

    #[test]
    fn none_when_base_missing() {
        assert_eq!(config_base(false, None, None), None);
        assert_eq!(config_base(true, None, None), None);
    }
}
