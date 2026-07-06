//! Integration tests for the PTY layer the bridge (src/lib.rs) is built on.
//!
//! These exercise `portable-pty` against a REAL shell — the same mechanism
//! `pty_spawn` uses — locking in the behavior the app depends on across
//! platforms. As the bridge grows a testable core, these will call into
//! `smterm_lib` directly. See TESTING.md §3 for the full edge-case catalog.

use std::io::{Read, Write};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Build a command that runs `script` through the platform shell.
fn shell_cmd(script: &str) -> CommandBuilder {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/C");
        c
    } else {
        let mut c = CommandBuilder::new("sh");
        c.arg("-c");
        c
    };
    cmd.arg(script);
    cmd
}

/// Read from `reader` until EOF, returning the output as a lossy string.
fn read_to_eof(reader: &mut (impl Read + ?Sized)) -> String {
    let mut out = String::new();
    let mut buf = [0u8; 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
    }
    out
}

#[test]
fn spawns_and_reads_output() {
    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    let mut child = pair
        .slave
        .spawn_command(shell_cmd("echo smterm-hello"))
        .unwrap();
    // Drop the slave so the reader sees EOF once the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().unwrap();
    let out = read_to_eof(&mut *reader);
    let _ = child.wait();

    assert!(out.contains("smterm-hello"), "output was: {out:?}");
}

#[cfg(unix)]
#[test]
fn writes_input_and_reads_it_back() {
    // `cat` echoes stdin back to stdout; also exercises the write path.
    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    let mut child = pair.slave.spawn_command(shell_cmd("cat")).unwrap();
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();

    writer.write_all(b"smterm-input\n").unwrap();
    writer.flush().unwrap();

    let mut buf = [0u8; 256];
    let n = reader.read(&mut buf).unwrap();
    let out = String::from_utf8_lossy(&buf[..n]).to_string();

    let _ = child.kill();
    let _ = child.wait();

    assert!(out.contains("smterm-input"), "output was: {out:?}");
}

#[test]
fn kill_terminates_child() {
    let long_running = if cfg!(target_os = "windows") {
        "ping -n 30 127.0.0.1 >NUL"
    } else {
        "sleep 30"
    };

    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    let mut child = pair.slave.spawn_command(shell_cmd(long_running)).unwrap();
    drop(pair.slave);

    // Still running before we kill it.
    assert!(
        child.try_wait().unwrap().is_none(),
        "child should still be running before kill"
    );

    child.kill().unwrap();
    // wait() must return (proves the process actually terminated, no orphan).
    let _ = child.wait().unwrap();
}

#[cfg(unix)]
#[test]
fn resize_is_seen_by_the_child() {
    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    // Delay `stty size` so we can resize before it runs.
    let mut child = pair
        .slave
        .spawn_command(shell_cmd("sleep 0.5; stty size"))
        .unwrap();
    drop(pair.slave);

    pair.master.resize(size(100, 40)).unwrap();

    let mut reader = pair.master.try_clone_reader().unwrap();
    let out = read_to_eof(&mut *reader);
    let _ = child.wait();

    // stty prints "rows cols".
    assert!(out.contains("40 100"), "resized size not seen: {out:?}");
}

#[cfg(unix)]
#[test]
fn multibyte_utf8_survives_byte_by_byte_reads() {
    let expected = "café-日本語-🚀";
    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    let mut child = pair
        .slave
        .spawn_command(shell_cmd(&format!("printf '%s' '{expected}'")))
        .unwrap();
    drop(pair.slave);

    // One byte at a time forces every multibyte char across a read boundary.
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut bytes = Vec::new();
    let mut one = [0u8; 1];
    loop {
        match reader.read(&mut one) {
            Ok(0) => break,
            Ok(_) => bytes.push(one[0]),
            Err(_) => break,
        }
    }
    let _ = child.wait();

    // Reassembled bytes must be valid UTF-8 and contain the original string.
    let decoded = String::from_utf8(bytes).expect("reassembled output is valid UTF-8");
    assert!(decoded.contains(expected), "got: {decoded:?}");
}

#[cfg(unix)]
#[test]
fn sessions_are_isolated() {
    // Two independent sessions each print their own marker and exit; neither
    // sees the other's output. Bounded by EOF (shell exit) — no blocking reads.
    let pty = native_pty_system();
    let a = pty.openpty(size(80, 24)).unwrap();
    let b = pty.openpty(size(80, 24)).unwrap();
    let mut ca = a.slave.spawn_command(shell_cmd("echo AAA-only")).unwrap();
    let mut cb = b.slave.spawn_command(shell_cmd("echo BBB-only")).unwrap();
    drop(a.slave);
    drop(b.slave);

    let mut ra = a.master.try_clone_reader().unwrap();
    let mut rb = b.master.try_clone_reader().unwrap();
    let out_a = read_to_eof(&mut *ra);
    let out_b = read_to_eof(&mut *rb);
    let _ = ca.wait();
    let _ = cb.wait();

    assert!(
        out_a.contains("AAA-only"),
        "A missing its output: {out_a:?}"
    );
    assert!(
        out_b.contains("BBB-only"),
        "B missing its output: {out_b:?}"
    );
    assert!(
        !out_a.contains("BBB-only"),
        "A leaked B's output: {out_a:?}"
    );
    assert!(
        !out_b.contains("AAA-only"),
        "B leaked A's output: {out_b:?}"
    );
}

#[cfg(unix)]
#[test]
fn large_output_burst_drains_without_loss() {
    let pty = native_pty_system();
    let pair = pty.openpty(size(80, 24)).unwrap();
    let mut child = pair
        .slave
        .spawn_command(shell_cmd("yes smterm | head -c 100000"))
        .unwrap();
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().unwrap();
    let out = read_to_eof(&mut *reader);
    let _ = child.wait();

    assert!(
        out.len() >= 100000,
        "expected >=100000 bytes, got {}",
        out.len()
    );
}

#[test]
fn rapid_spawn_and_kill_is_stable() {
    let long_running = if cfg!(target_os = "windows") {
        "ping -n 30 127.0.0.1 >NUL"
    } else {
        "sleep 30"
    };

    let pty = native_pty_system();
    for _ in 0..20 {
        let pair = pty.openpty(size(80, 24)).unwrap();
        let mut child = pair.slave.spawn_command(shell_cmd(long_running)).unwrap();
        drop(pair.slave);
        child.kill().unwrap();
        let _ = child.wait().unwrap();
    }
}
