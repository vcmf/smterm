//! Auto shell-integration: inject OSC 133 hooks into spawned shells without
//! editing the user's dotfiles, so smterm can track command start/finish.
//!
//! zsh uses the ZDOTDIR wrapper; bash uses `--rcfile`. Best-effort — the caller
//! falls back to a plain shell if anything here returns None.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const ZSH_ZSHENV: &str = include_str!("../shell-integration/zsh/zshenv");
const ZSH_ZSHRC: &str = include_str!("../shell-integration/zsh/zshrc");
const ZSH_ZPROFILE: &str = include_str!("../shell-integration/zsh/zprofile");
const ZSH_ZLOGIN: &str = include_str!("../shell-integration/zsh/zlogin");
const BASH_RC: &str = include_str!("../shell-integration/bash/bashrc");

/// Env vars + extra args to apply when spawning an integrated shell.
#[derive(Debug, PartialEq, Eq)]
pub struct Injection {
    pub env: Vec<(String, String)>,
    pub args: Vec<String>,
}

/// Write the integration scripts under `base`. Idempotent.
pub fn materialize(base: &Path) -> io::Result<()> {
    let zsh = base.join("zsh");
    fs::create_dir_all(&zsh)?;
    fs::write(zsh.join(".zshenv"), ZSH_ZSHENV)?;
    fs::write(zsh.join(".zshrc"), ZSH_ZSHRC)?;
    fs::write(zsh.join(".zprofile"), ZSH_ZPROFILE)?;
    fs::write(zsh.join(".zlogin"), ZSH_ZLOGIN)?;
    let bash = base.join("bash");
    fs::create_dir_all(&bash)?;
    fs::write(bash.join("bashrc"), BASH_RC)?;
    Ok(())
}

/// Pure: compute the injection for `shell`, or None if it's unsupported.
pub fn build_injection(
    shell: &str,
    base: &Path,
    user_zdotdir: Option<&str>,
    home: Option<&str>,
) -> Option<Injection> {
    let name = Path::new(shell).file_name()?.to_str()?;
    if name == "zsh" || name.ends_with("-zsh") {
        let ours = base.join("zsh").to_string_lossy().into_owned();
        let user = user_zdotdir.or(home).unwrap_or("").to_string();
        Some(Injection {
            env: vec![
                ("ZDOTDIR".into(), ours.clone()),
                ("SMTERM_ZDOTDIR".into(), ours),
                ("SMTERM_USER_ZDOTDIR".into(), user),
                ("SMTERM_SHELL_INTEGRATION".into(), "1".into()),
            ],
            args: vec![],
        })
    } else if name == "bash" {
        let rc = base
            .join("bash")
            .join("bashrc")
            .to_string_lossy()
            .into_owned();
        Some(Injection {
            env: vec![("SMTERM_SHELL_INTEGRATION".into(), "1".into())],
            args: vec!["--rcfile".into(), rc],
        })
    } else {
        None
    }
}

/// Default location for materialized scripts.
fn default_base() -> PathBuf {
    std::env::temp_dir()
        .join("smterm")
        .join("shell-integration")
}

/// Used at spawn time: materialize + resolve env + build. Returns None (silent
/// fallback) on any failure or unsupported shell.
pub fn integration_for(shell: &str) -> Option<Injection> {
    let base = default_base();
    materialize(&base).ok()?;
    let user_zdotdir = std::env::var("ZDOTDIR").ok();
    let home = std::env::var("HOME").ok();
    build_injection(shell, &base, user_zdotdir.as_deref(), home.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zsh_injection_sets_zdotdir() {
        let inj =
            build_injection("/bin/zsh", Path::new("/b"), Some("/u/.zsh"), Some("/u")).unwrap();
        assert!(inj.args.is_empty());
        assert!(inj.env.contains(&("ZDOTDIR".into(), "/b/zsh".into())));
        assert!(inj
            .env
            .contains(&("SMTERM_USER_ZDOTDIR".into(), "/u/.zsh".into())));
        assert!(inj
            .env
            .contains(&("SMTERM_SHELL_INTEGRATION".into(), "1".into())));
    }

    #[test]
    fn zsh_falls_back_to_home_without_zdotdir() {
        let inj = build_injection("zsh", Path::new("/b"), None, Some("/u")).unwrap();
        assert!(inj
            .env
            .contains(&("SMTERM_USER_ZDOTDIR".into(), "/u".into())));
    }

    #[test]
    fn bash_injection_uses_rcfile() {
        let inj = build_injection("/bin/bash", Path::new("/b"), None, None).unwrap();
        assert_eq!(
            inj.args,
            vec!["--rcfile".to_string(), "/b/bash/bashrc".to_string()]
        );
    }

    #[test]
    fn unsupported_shells_return_none() {
        for s in [
            "sh",
            "fish",
            "/usr/bin/fish",
            "powershell.exe",
            "cmd.exe",
            "wsl.exe",
        ] {
            assert!(
                build_injection(s, Path::new("/b"), None, None).is_none(),
                "{s}"
            );
        }
    }

    #[test]
    fn materialize_writes_scripts() {
        let base = std::env::temp_dir().join("smterm-test-materialize");
        let _ = fs::remove_dir_all(&base);
        materialize(&base).unwrap();
        assert!(base.join("zsh/.zshrc").exists());
        assert!(base.join("zsh/.zshenv").exists());
        assert!(base.join("bash/bashrc").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
