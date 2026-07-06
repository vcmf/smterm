//! End-to-end: spawn a real zsh/bash WITH smterm integration and assert the
//! shell emits OSC 133 marks around a command. Skips gracefully if the shell
//! isn't installed (e.g. some CI images).

use std::io::{Read, Write};
use std::path::Path;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use smterm_lib::shell_integration::{build_injection, materialize};

fn have(bin: &str) -> bool {
    std::process::Command::new(bin)
        .arg("--version")
        .output()
        .is_ok()
}

/// Spawn `shell` with integration applied, run a command, return all output.
fn capture(shell: &str, base: &Path) -> String {
    materialize(base).unwrap();
    let inj = build_injection(shell, base, None, std::env::var("HOME").ok().as_deref()).unwrap();

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();

    let mut cmd = CommandBuilder::new(shell);
    for (key, value) in &inj.env {
        cmd.env(key, value);
    }
    for arg in &inj.args {
        cmd.arg(arg);
    }
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    writer.write_all(b"echo smterm-133-test\n").unwrap();
    writer.write_all(b"exit\n").unwrap();
    writer.flush().unwrap();

    let mut out = String::new();
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
    }
    let _ = child.wait();
    out
}

#[test]
fn zsh_emits_osc133_marks() {
    if !have("zsh") {
        eprintln!("zsh not installed; skipping");
        return;
    }
    let out = capture("zsh", &std::env::temp_dir().join("smterm-it-zsh"));
    assert!(
        out.contains("\u{1b}]133;C"),
        "no command-start mark in: {out:?}"
    );
    assert!(
        out.contains("\u{1b}]133;D"),
        "no command-finish mark in: {out:?}"
    );
}

#[test]
fn bash_emits_osc133_marks() {
    if !have("bash") {
        eprintln!("bash not installed; skipping");
        return;
    }
    let out = capture("bash", &std::env::temp_dir().join("smterm-it-bash"));
    assert!(
        out.contains("\u{1b}]133;C"),
        "no command-start mark in: {out:?}"
    );
    assert!(
        out.contains("\u{1b}]133;D"),
        "no command-finish mark in: {out:?}"
    );
}
