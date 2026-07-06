// smterm — PTY bridge (M0)
//
// The only "real" Rust in the project. Kept deliberately simple and synchronous
// (plain threads, one Mutex<HashMap>) so the borrow checker stays out of the way.
// It exposes four commands to the frontend and streams PTY output over a channel.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, State};

pub mod settings;
pub mod shell_integration;

/// One live terminal session.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// App-wide registry of sessions, keyed by an id the frontend generates.
#[derive(Default)]
struct PtyManager(Mutex<HashMap<String, PtySession>>);

/// The user's default shell for the current OS.
fn default_shell() -> String {
    let is_windows = cfg!(target_os = "windows");
    let env_shell = if is_windows {
        std::env::var("COMSPEC").ok()
    } else {
        std::env::var("SHELL").ok()
    };
    resolve_shell(is_windows, env_shell)
}

/// Pure shell-resolution logic, split out so it can be unit-tested without
/// touching the process environment.
fn resolve_shell(is_windows: bool, env_shell: Option<String>) -> String {
    match env_shell.filter(|s| !s.is_empty()) {
        Some(shell) => shell,
        None if is_windows => "powershell.exe".to_string(),
        None => "/bin/bash".to_string(),
    }
}

/// A shell/profile the user can launch from the "New" picker.
#[derive(Serialize)]
struct ShellOption {
    id: String,
    label: String,
    command: String,
    args: Vec<String>,
}

/// Basename of a shell path, used as a friendly label.
fn shell_label(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Parse `wsl.exe -l -q` output (one distro name per line) into a list.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_wsl_distros(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|line| line.trim_matches(|c: char| c.is_whitespace() || c == '\0'))
        .filter(|line| !line.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Decode `wsl.exe` output, which is UTF-16LE on Windows.
#[cfg(target_os = "windows")]
fn decode_wsl(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.iter().any(|&b| b == 0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Enumerate installed WSL distros (Windows only).
#[cfg(target_os = "windows")]
fn wsl_distros() -> Vec<String> {
    match std::process::Command::new("wsl.exe")
        .args(["-l", "-q"])
        .output()
    {
        Ok(out) => parse_wsl_distros(&decode_wsl(&out.stdout)),
        Err(_) => Vec::new(),
    }
}

/// The shells/profiles available on this machine, for the "New" picker.
#[tauri::command]
fn list_shells() -> Vec<ShellOption> {
    let mut out = Vec::new();

    #[cfg(target_os = "windows")]
    {
        out.push(ShellOption {
            id: "powershell".into(),
            label: "PowerShell".into(),
            command: "powershell.exe".into(),
            args: vec![],
        });
        out.push(ShellOption {
            id: "cmd".into(),
            label: "Command Prompt".into(),
            command: "cmd.exe".into(),
            args: vec![],
        });
        for distro in wsl_distros() {
            out.push(ShellOption {
                id: format!("wsl:{distro}"),
                label: format!("WSL: {distro}"),
                command: "wsl.exe".into(),
                args: vec!["-d".into(), distro],
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let default = default_shell();
        out.push(ShellOption {
            id: "default".into(),
            label: shell_label(&default),
            command: default,
            args: vec![],
        });
        for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if std::path::Path::new(candidate).exists()
                && !out.iter().any(|s| s.command == candidate)
            {
                out.push(ShellOption {
                    id: candidate.into(),
                    label: shell_label(candidate),
                    command: candidate.into(),
                    args: vec![],
                });
            }
        }
    }

    out
}

/// Spawn a shell in a new PTY and stream its output back over `on_data`.
#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    args: Option<Vec<String>>,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = shell
        .filter(|s| !s.is_empty())
        .unwrap_or_else(default_shell);
    // Best-effort shell integration (OSC 133 marks); None → plain shell.
    let injection = shell_integration::integration_for(&shell);
    let mut cmd = CommandBuilder::new(shell);
    if let Some(args) = args {
        for arg in args {
            cmd.arg(arg);
        }
    }
    if let Some(inj) = injection {
        for (key, value) in inj.env {
            cmd.env(key, value);
        }
        for arg in inj.args {
            cmd.arg(arg);
        }
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Drop the slave handle so the reader sees EOF once the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Reader thread: blocking read loop, push each chunk to the frontend.
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: shell exited
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break; // frontend went away
                    }
                }
                Err(_) => break,
            }
        }
    });

    state.0.lock().unwrap().insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

/// Send keystrokes / pasted text to a session.
#[tauri::command]
fn pty_write(state: State<PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let session = map.get_mut(&id).ok_or("no such pty")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize a session's PTY to match the terminal's cols/rows.
#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let session = map.get(&id).ok_or("no such pty")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Kill a session and forget it.
#[tauri::command]
fn pty_kill(state: State<PtyManager>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.0.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            list_shells,
            settings::settings_file_path,
            settings::read_settings_file,
            settings::write_settings_file
        ])
        .setup(|app| {
            settings::start_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill all child shells when the window closes — no orphans.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<PtyManager>() {
                    let mut map = state.0.lock().unwrap();
                    for (_, mut session) in map.drain() {
                        let _ = session.child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_wsl_distros, resolve_shell};

    #[test]
    fn parses_wsl_distro_list() {
        let out = "Ubuntu\r\nDebian\r\nkali-linux\r\n";
        assert_eq!(
            parse_wsl_distros(out),
            vec!["Ubuntu", "Debian", "kali-linux"]
        );
        assert!(parse_wsl_distros("\r\n   \r\n").is_empty());
    }

    #[test]
    fn uses_env_shell_when_set() {
        assert_eq!(resolve_shell(false, Some("/bin/zsh".into())), "/bin/zsh");
        assert_eq!(resolve_shell(true, Some("cmd.exe".into())), "cmd.exe");
    }

    #[test]
    fn falls_back_when_missing() {
        assert_eq!(resolve_shell(false, None), "/bin/bash");
        assert_eq!(resolve_shell(true, None), "powershell.exe");
    }

    #[test]
    fn treats_empty_as_missing() {
        assert_eq!(resolve_shell(false, Some(String::new())), "/bin/bash");
        assert_eq!(resolve_shell(true, Some(String::new())), "powershell.exe");
    }
}
