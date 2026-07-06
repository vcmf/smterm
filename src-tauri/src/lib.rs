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
use tauri::ipc::Channel;
use tauri::State;

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

/// Spawn a shell in a new PTY and stream its output back over `on_data`.
#[tauri::command]
fn pty_spawn(
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
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
    let cmd = CommandBuilder::new(shell);
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
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn, pty_write, pty_resize, pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::resolve_shell;

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
