# Architecture — smterm (Cross-Platform Terminal App)

> A lightweight, cmux-inspired terminal app for running (and watching) multiple shell/agent
> sessions. No embedded browser — links open in the OS default browser. Native desktop
> notifications. Runs on **macOS, Linux, Windows, and WSL**.

Status: **DRAFT / pre-scaffold** — this doc is the plan we agree on before writing code.

### Decisions locked (2026-07-06)

- **Purpose:** coding-agent runner (cmux-like) — running/watching multiple agent sessions. Notifications & per-session "attention" state are headline features.
- **Frontend:** React + TypeScript.
- **Layout:** tabs **+ split panes** from v1 (not deferred).
- **Windows/WSL:** native Windows app that spawns `wsl.exe`; never run inside WSL.

---

## 1. Goals & non-goals

### Goals

- Run and **watch multiple coding-agent / shell sessions** in one window (tabs **+ split panes**).
- Per-session **status & "attention" state** (running / idle / waiting-for-input / done) surfaced at a glance.
- Real PTY-backed shells — full interactive programs work (vim, top, TUIs, coding agents).
- **Native OS notifications** — an agent finishes or asks for input while its tab/window is unfocused. (Headline feature.)
- **Clickable links open the OS default browser** (no embedded webview browsing).
- One codebase, four targets: macOS, Linux, Windows, WSL.
- Small footprint (this is why we pick Tauri over Electron).

### Non-goals (at least for v1)

- Embedded browser / web panel (cmux has this; we deliberately don't).
- Reconnecting to sessions after the app quits (needs a persistent daemon or tmux — see §12).
- Remote/SSH session management as a first-class feature (you can still `ssh` inside a shell).
- Mobile / web builds.

---

## 2. The cross-platform strategy (the crux)

Two decisions carry almost all of the cross-platform weight:

### 2a. One PTY abstraction for all OSes

We use the **`portable-pty`** crate (from the WezTerm project). It presents a single API and
picks the right OS backend underneath:

| OS            | PTY backend used by `portable-pty`                 |
| ------------- | -------------------------------------------------- |
| macOS / Linux | `openpty`/`forkpty` (Unix PTY)                     |
| Windows       | **ConPTY** (the modern Windows pseudo-console API) |

This means we write the PTY bridge **once** and it works everywhere. This is the single most
important portability choice in the project.

### 2b. On Windows, the app is a native Windows app; WSL is just a _shell target_

This is the key insight that removes almost all WSL pain:

- **Do:** run the app as a normal Windows desktop app, and spawn WSL shells by launching
  `wsl.exe [-d <distro>]` as the shell command through ConPTY.
- **Don't:** run the app _inside_ WSL as a Linux GUI (WSLg). That path has flaky notifications,
  awkward "open browser", and harder packaging.

Result: from a single Windows install the user gets PowerShell, cmd, **and** full WSL terminals —
while notifications, link-opening, and packaging all use the native Windows APIs that actually work.

```
                        ┌─────────────────────────────────────┐
   Windows host app  ──►│  wsl.exe  ──►  bash inside Ubuntu     │   (WSL = a shell we spawn)
        │               └─────────────────────────────────────┘
        ├──► powershell.exe / cmd.exe
        └──► native Windows notifications + default-browser open + MSI packaging
```

### Cross-platform capability matrix

| Concern       | macOS               | Linux                      | Windows          | WSL                                    |
| ------------- | ------------------- | -------------------------- | ---------------- | -------------------------------------- |
| PTY           | Unix PTY            | Unix PTY                   | ConPTY           | via `wsl.exe` on Windows host (ConPTY) |
| Default shell | `$SHELL` (zsh)      | `$SHELL` (bash/zsh)        | PowerShell / cmd | distro default (bash)                  |
| Open link     | `open`              | `xdg-open`                 | `ShellExecute`   | (handled by Windows host)              |
| Notifications | Notification Center | libnotify / D-Bus          | WinRT toast      | (handled by Windows host)              |
| Package       | `.dmg` / `.app`     | `.deb` / `.rpm` / AppImage | `.msi` / `.exe`  | (uses Windows build)                   |

All of the above are provided by `portable-pty` + Tauri plugins + the Tauri bundler — no per-OS
hand-rolling beyond a small shell-selection map.

---

## 3. Tech stack

| Layer               | Choice                                                  | Why                                                                                       |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Shell / packaging   | **Tauri 2**                                             | Native webview (small binary, low RAM), cross-platform bundler, plugin ecosystem          |
| Terminal renderer   | **xterm.js** + addons                                   | The de-facto web terminal (VS Code, Hyper). WebGL renderer, links, search, fit            |
| PTY backend         | **`portable-pty`** (hand-rolled bridge)                 | One API → ConPTY + Unix PTY. We hand-roll rather than use the immature `tauri-plugin-pty` |
| Frontend framework  | **React + TypeScript** (or Svelte — see Open Decisions) | Familiar, fast to build UI/tabs/state                                                     |
| Open link           | `tauri-plugin-opener`                                   | OS-native default-browser open, zero Rust                                                 |
| Notifications       | `tauri-plugin-notification`                             | OS-native toasts, zero Rust                                                               |
| Persistence         | JSON in app config dir (via `tauri-plugin-store` or fs) | Save layout/tabs/cwd                                                                      |
| Auto-update (later) | `tauri-plugin-updater`                                  | Optional                                                                                  |

**Rust footprint:** essentially just the PTY bridge (~150–250 lines, §7). Everything else is
TypeScript. The Rust that exists sits inside the compiler's tight feedback loop, which is where
that strictness actually helps an AI agent write it correctly.

---

## 4. High-level architecture

```
┌──────────────────────────── Webview (TypeScript) ────────────────────────────┐
│                                                                                │
│  React UI: tab bar, session list, status                                       │
│     │                                                                           │
│     ├── Terminal component (one per session)                                    │
│     │      xterm.js  ── addons: webgl, fit, web-links, search, unicode11        │
│     │        ▲  bytes out (render)          │ bytes in (keystrokes)             │
│     │        │                              ▼                                    │
│     └── Session manager (TS): map<id, {pty channel, title, cwd, shell}>         │
│              │  invoke: pty_spawn / pty_write / pty_resize / pty_kill           │
│              │  channel:  pty output stream  (Tauri ipc::Channel<bytes>)        │
└──────────────┼─────────────────────────────────────────────────────────────────┘
               │  Tauri IPC
┌──────────────┴──────────────────── Rust core (src-tauri) ─────────────────────┐
│                                                                                │
│  Commands:  pty_spawn, pty_write, pty_resize, pty_kill                          │
│  State:     Mutex<HashMap<SessionId, PtyHandle>>                                │
│  Per session: portable-pty pair + reader thread → streams bytes to webview      │
│                                                                                │
│  Plugins (no custom Rust): opener (links), notification (toasts), store (persist)│
└────────────────────────────────────────────────────────────────────────────────┘
                   │ spawns
        zsh / bash / powershell.exe / cmd.exe / wsl.exe
```

---

## 5. Features & how we achieve each

| #   | Feature                           | How                                                                             | Effort |
| --- | --------------------------------- | ------------------------------------------------------------------------------- | ------ |
| F1  | Real interactive terminal         | xterm.js ⇄ `portable-pty` bridge (§7)                                           | Core   |
| F2  | Multiple sessions (tabs)          | Session manager in TS; one PTY + one xterm instance per tab                     | Core   |
| F3  | Cross-platform shells             | Shell-selection map (§6) + spawn via ConPTY/Unix PTY                            | Core   |
| F4  | WSL sessions                      | On Windows, spawn `wsl.exe [-d distro]` as the shell (§2b)                      | Core   |
| F5  | Clickable links → default browser | `@xterm/addon-web-links` detects URLs → on click call `tauri-plugin-opener`     | Small  |
| F6  | Native notifications              | `tauri-plugin-notification`, triggered by rules in §9                           | Small  |
| F7  | Resize handling                   | `@xterm/addon-fit` on container resize → `pty_resize(cols,rows)`                | Small  |
| F8  | Fast rendering                    | `@xterm/addon-webgl` (canvas fallback)                                          | Small  |
| F9  | Scrollback + search               | xterm built-in scrollback + `@xterm/addon-search`                               | Small  |
| F10 | Copy / paste                      | xterm selection + clipboard; right-click / keybind                              | Small  |
| F11 | Persist layout                    | Save tabs/cwd/titles to config JSON; restore on launch (new PTYs, §12)          | Medium |
| F12 | Session titles / rename           | Track OSC 0/2 title escapes; allow manual rename                                | Small  |
| F13 | Themes / fonts                    | xterm theme object; font family/size in settings                                | Small  |
| F14 | **Split panes**                   | Split a tab into multiple terminals; resizable pane tree (§8)                   | Core   |
| F15 | **Per-session status/attention**  | Track running/idle/waiting/done; badge on tab + pane; drives notifications (§9) | Core   |
| F16 | Session overview                  | Tab bar + optional grid glance showing every session's status/unread            | Medium |

---

## 6. Shell selection (cross-platform)

Default shell resolution, in order:

- **macOS/Linux:** `$SHELL` → fallback `/bin/zsh` (mac) / `/bin/bash` (linux).
- **Windows:** prefer `pwsh.exe` (PowerShell 7) → fallback `powershell.exe` → `cmd.exe`.
- **WSL (from Windows):** `wsl.exe` (default distro) or `wsl.exe -d <distro>`; enumerate distros via `wsl.exe -l -q`.

The user can pick a shell per new session from a dropdown ("New tab ▾": zsh / PowerShell / Ubuntu (WSL) / …).
Config stores the default. On Windows we detect installed WSL distros at startup and list them.

---

## 7. The PTY bridge (the one piece of real Rust)

Design kept deliberately simple to stay easy for the compiler-feedback loop:

- **State:** `Mutex<HashMap<SessionId, Session>>`, where `Session` owns the PTY master writer + child handle.
- **`pty_spawn(shell, args, cwd, cols, rows) -> SessionId`**
  - Create a `portable-pty` PTY pair, spawn the command.
  - Take the reader half; spawn a **plain `std::thread`** (not async) with a blocking read loop.
  - Each chunk read → send to the frontend over a **Tauri `ipc::Channel<Vec<u8>>`** (better than
    events for high-throughput streaming; avoids JSON overhead per keystroke of output).
  - Store the writer + child in state.
- **`pty_write(id, bytes)`** → write to the stored master writer.
- **`pty_resize(id, cols, rows)`** → `pty.resize(PtySize{…})`.
- **`pty_kill(id)`** → kill child, drop from state, join thread.
- **Cleanup:** on window close / app exit, kill all children (avoid orphaned shells).

Deliberate simplicity choices:

- Threads + blocking reads over `async`/tokio → far simpler ownership, fewer borrow-checker fights.
- One reader thread per session; back-pressure handled by the channel.
- No shared mutable PTY state beyond the `Mutex<HashMap>`.

> Why hand-rolled and not `tauri-plugin-pty`: that plugin is early (v0.1.x, single maintainer). The
> bridge above is small, and Rust's compiler diagnostics make it a good fit for AI-assisted authoring.
> If we ever hit a wall, the fallback is a **Node `node-pty` sidecar** bundled by Tauri (§13).

---

## 8. Frontend design (React + TypeScript)

- **State (Zustand):** `Session { id, title, cwd, shell, status, unread }` +
  a **layout tree** per tab describing the split arrangement.
- **Layout model:** each tab holds a binary **pane tree** — nodes are either a leaf (one terminal)
  or a split (`direction: 'row'|'col'`, children, sizes). Resizable dividers adjust `sizes`; each
  leaf resize triggers fit → `pty_resize`. A simple, well-trodden shape (same as VS Code/tmux panes).
- **Terminal component:** wraps one xterm instance; mounts addons; binds:
  - `term.onData(bytes => invoke('pty_write', {id, bytes}))`
  - channel `onmessage(bytes => term.write(bytes))`
  - `ResizeObserver` → fit addon → `invoke('pty_resize', …)`
- **Addons:** `webgl`, `fit`, `web-links`, `search`, `unicode11`, `clipboard`.
- **Tab bar:** create/close/rename/reorder; shell picker on "new"; **status badge per tab** (F15).
- **Split controls:** split current pane horizontally/vertically; close pane; focus-follows-click.
- **Lifecycle:** keep background terminals mounted so switching tabs/panes is instant.

---

## 9. Notifications design

Trigger sources (support progressively):

1. **Explicit escape sequences (best for agents):** honor **OSC 9** (`ESC ] 9 ; message BEL`) and/or
   **OSC 777** — a program (or coding agent) prints an escape code and we raise an OS notification.
   This lets any tool trigger a notification intentionally.
2. **Terminal bell (`\a`):** optional "notify on bell when unfocused".
3. **Command-finished heuristic:** notify when a long-running foreground command exits and the window
   is unfocused. (Shell-integration escape sequences — OSC 133 prompt marks — make this precise; optional.)
4. **Focus awareness:** only fire when the window/tab is not focused; clicking the notification focuses
   that session's tab.

Rules are user-configurable (per trigger on/off). Delivery via `tauri-plugin-notification`.

Platform notes: notifications need app **identity** to be reliable — macOS wants a signed bundle,
Windows wants an AppUserModelID (set by the installer). This is handled at packaging time (§10).

---

## 10. Packaging & distribution

Tauri's bundler produces native installers per OS:

- **macOS:** `.app` + `.dmg`. For reliable notifications & Gatekeeper: **codesign + notarize**
  (Apple Developer account, $99/yr).
- **Windows:** `.msi` (WiX) or `.exe` (NSIS). Set **AppUserModelID** for toasts. Code-signing cert
  optional but avoids SmartScreen warnings.
- **Linux:** `.deb`, `.rpm`, **AppImage**. Notifications via libnotify (present on most desktops).

CI: GitHub Actions matrix (macos, ubuntu, windows) building all targets. Auto-update optional via
`tauri-plugin-updater` (needs signing keys).

> Reality check: **packaging + signing is the most tedious part of the whole project** — more than the
> code. Budget time for Apple notarization and Windows identity specifically.

---

## 11. IPC / event model

- **Frontend → Rust:** Tauri **commands** (`invoke`): `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`.
- **Rust → Frontend:** Tauri **`ipc::Channel<Vec<u8>>`** per session for streaming PTY output
  (preferred over global events for high-frequency binary data). App-level notifications/status can use
  ordinary Tauri events.
- Byte encoding across the boundary: raw bytes via channel; frontend decodes with xterm's UTF-8 handling.

---

## 12. Persistence & session lifetime

- **What we persist:** window size, tab list (title, shell, last cwd), theme/font, notification prefs —
  saved to the app config dir as JSON.
- **What we do NOT persist (v1):** live process state. When the app quits, PTYs die. On relaunch we
  recreate tabs with fresh shells at the saved cwd.
- **Future — reattach to running sessions:** requires a detached backend (a small daemon holding the
  PTYs, or leveraging `tmux`/`zellij` under the hood). Out of scope for v1; noted so we don't design
  ourselves into a corner. **Full design sketch in [Appendix A](#appendix-a--session-persistence-via-a-detached-daemon-design-sketch).**

---

## 13. Risks & mitigations

| Risk                                                     | Mitigation                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `portable-pty` PTY bridge has tricky ownership/threading | Keep it tiny + synchronous (threads, not async); lean on compiler feedback loop  |
| Immature `tauri-plugin-pty`                              | Not used — we hand-roll. Fallback: `node-pty` **sidecar** bundled by Tauri       |
| High-throughput output jank                              | Use `ipc::Channel` + WebGL renderer; batch writes; cap scrollback                |
| Notifications unreliable w/o app identity                | Sign macOS build; set Windows AppUserModelID at install                          |
| WSL complexity                                           | Treat WSL as a shell target on a native Windows app (§2b), never host inside WSL |
| Code-signing/notarization friction                       | Budget time; start CI signing early, not at release                              |
| Orphaned shell processes                                 | Kill all children on window close / app exit                                     |

---

## 14. Decisions

Resolved (2026-07-06):

1. **Primary purpose:** ✅ coding-agent runner — notifications & per-session attention state are headline.
2. **Frontend framework:** ✅ React + TypeScript.
3. **Layout model:** ✅ tabs **+ split panes** from v1.
4. **Windows/WSL:** ✅ native Windows app spawning `wsl.exe`.

Still open: 5. **Notification triggers to ship first** — recommend **OSC 9** (agent-emitted) + **unfocused
activity/idle-transition**, since this is an agent runner. OSC 133 prompt marks (precise
command-done detection) can follow. 6. **Agent status detection strategy** — how do we know a session is "waiting for input" vs "working"
vs "done"? Options: (a) shell-integration escape sequences (OSC 133), (b) agents emit OSC 9,
(c) output-idle heuristic. Likely a blend. Needs a short spike. 7. **Project name.**

---

## 15. Suggested milestones

- **M0 — Spike:** Tauri app, one xterm ⇄ one `portable-pty` shell, echoes keystrokes, resizes. (Proves the core + the "1 line vs 150 lines of Rust" reality.)
- **M1 — Multi-session + layout:** tabs, **split panes**, shell picker, per-OS default shells, WSL on Windows.
- **M2 — Headline features:** native notifications (OSC 9 + unfocused activity), per-session status/attention badges, clickable links → default browser.
- **M3 — Polish:** search, copy/paste, themes/fonts, persist layout, session overview.
- **M4 — Packaging:** signed builds for macOS/Windows/Linux via CI.
- **M5 (later):** auto-update, session reattach (daemon/tmux — see [Appendix A](#appendix-a--session-persistence-via-a-detached-daemon-design-sketch)), advanced agent-status detection.

---

## Appendix A — Session persistence via a detached daemon (design sketch)

> **Status: exploratory, post-v1.** This is _not_ on the v1 path. It's written down now only so the
> M0/M1 code doesn't paint us into a corner. The single actionable takeaway for v1 is in
> [A.6](#a6-what-to-do-in-v1-so-this-stays-cheap-later).

### A.1 What it buys us (and what it doesn't)

"tmux-style persistence" means the **session outlives the UI**: an agent keeps running after you
close the window (or it crashes), and you reattach later to the live screen. Concretely:

- ✅ Close/reopen the app → sessions still running, reattach to current screen.
- ✅ GUI crash → shells survive (they're owned by a different process).
- ✅ (Later) attach the same session from a second window / view.
- ❌ **Survive a machine reboot** — out of scope; tmux doesn't do this either (no process migration).
- ❌ **Own remote daemon on every server** — explicitly rejected; we wrap existing `tmux`/`mosh`
  instead (see [A.5](#a5-remote-sessions-dont-build-a-remote-daemon)).

### A.2 The core move: split the PTY owner from the UI

Today (M0) a _single_ process — the Tauri app — both owns the PTYs and renders them. `PtyManager`
(the `Mutex<HashMap<String, PtySession>>` in `lib.rs`) lives inside the GUI process, and the reader
thread streams bytes straight to the webview over a Tauri `ipc::Channel`. When the app dies, the
`HashMap` dies with it, children get killed on `CloseRequested`, and everything is gone.

Persistence requires moving PTY ownership **out** of the GUI into a long-lived **session daemon**:

```
        Today (M0/M1) — one process                Future — client / daemon split
   ┌──────────────────────────────┐          ┌───────────────┐   ┌──────────────────────────┐
   │  Tauri GUI process            │          │  Tauri GUI    │   │  smterm-daemon (detached) │
   │   webview (xterm.js)          │          │  (thin client)│   │   owns all PTYs           │
   │      ▲ Channel                │          │   xterm.js    │   │   headless VT state model │
   │      │                        │   ──►     │      ▲        │   │      ▲   per session      │
   │   PtyManager  ── owns PTYs    │          │      │ socket  │   │      │                    │
   │      │ spawns                 │          │      └─────────┼───┼──────┘  IPC (framed)      │
   │   zsh / agent                 │          │  dies freely   │   │   zsh / agent (survive)   │
   └──────────────────────────────┘          └───────────────┘   └──────────────────────────┘
```

The GUI becomes a **thin client**: it connects to the daemon, sends keystrokes/resizes, and paints
byte streams. The daemon holds all the state. This is the same client/server split tmux and
`zellij` use.

### A.3 The genuinely hard part: the daemon must model the _screen_, not pipe bytes

This is what people underestimate. A reattaching client wasn't connected while output flowed, so it
can't just resume the byte stream — it needs the **current screen contents** to repaint. Therefore
the daemon can't be a dumb pipe; per session it must maintain a **headless terminal emulator**:

- grid of cells (glyph + fg/bg + attributes),
- cursor position + saved cursor,
- scrollback ring buffer,
- modes (alt-screen for vim/htop, bracketed paste, mouse, wrap),
- current title (OSC 0/2), and the pending-notification / status state we already track (§9, §15).

We do **not** write a VT parser — mature Rust libraries do exactly this: **`wezterm-term`** (same
project as our `portable-pty`, so natural fit), `alacritty_terminal`, or `vt100`. The daemon feeds
PTY output into the parser (updating the model) _and_ forwards raw bytes to any attached client.

**Attach protocol** per session:

1. Client connects, sends `attach(session_id, cols, rows)`.
2. Daemon serializes the current screen model → sends an **initial paint** (either a state snapshot
   the client applies, or a stream of escape sequences that reconstruct the screen — the latter lets
   the client stay a plain xterm.js with no model of its own).
3. Daemon then streams **live bytes** as they arrive.
4. On client disconnect the daemon keeps the PTY + model alive; output keeps updating the model.

### A.4 IPC transport & lifecycle

| Concern             | Approach                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Transport (mac/lin) | **Unix domain socket** in the app runtime dir                                                     |
| Transport (Windows) | **Named pipe** (`\\.\pipe\smterm-…`)                                                              |
| Framing             | Length-prefixed messages; a tiny tagged protocol (`attach`, `write`, `resize`, `data`, `exit`)    |
| Daemon spawn        | GUI auto-spawns the daemon on first launch if not already running (discover via pidfile/socket)   |
| Daemon shutdown     | Reference-count sessions; auto-exit when the last session closes **and** no client is attached    |
| Resize w/ 2 clients | Per-session "owner" sets size, or smallest-attached-wins (tmux's model); propagate via `SIGWINCH` |
| Child cleanup       | Daemon owns the kill-on-exit responsibility; **remove** the GUI's `CloseRequested` kill-all       |

The daemon is the _same Rust binary_ in a different mode (`smterm --daemon`) or a small sibling
crate — it already has the `portable-pty` code; it just adds the parser + socket server.

### A.5 Remote sessions: don't build a remote daemon

The HN complaint that cmux "doesn't work on remote terminals" is about persistence living on the
_server_. Building our own remote daemon means **shipping and running our binary on every host we
SSH into** — a distribution problem, not a coding one, and the reason nobody does it. `tmux` is
already on virtually every machine.

**Pragmatic design: wrap the remote's existing multiplexer.** A "remote session" is just a local
session whose command is:

```
ssh <host> -t 'tmux new -A -s <name>'        # or: mosh <host> -- tmux new -A -s <name>
```

The persistence lives in the remote's tmux; our daemon only needs to hold the _local_ SSH process
(so a dropped GUI doesn't drop the SSH pipe). This gets reattach-on-the-server essentially for free.

| Capability                     | Own local daemon (A.2–A.4) | Wrap remote `tmux`/`mosh` (A.5)    |
| ------------------------------ | -------------------------- | ---------------------------------- |
| Survive GUI quit/crash (local) | ✅                         | ✅ (via local daemon holding ssh)  |
| Survive on a **remote** server | ❌                         | ✅ (tmux on the host)              |
| Roaming / flaky connection     | n/a                        | ✅ with `mosh`                     |
| Requires deploying our binary  | no (local only)            | **no** — uses what's already there |

### A.6 What to do in v1 so this stays cheap later

The refactor is only expensive if v1 hard-wires the GUI to the PTY. One cheap insulation now:

- **Put the session backend behind a trait/interface**, e.g. `SessionBackend { spawn, write, resize,
kill, subscribe }`. v1 ships the trivial **in-process** implementation (today's `PtyManager`,
  unchanged behaviour). The daemon becomes a _second_ implementation of the same trait later; the
  frontend contract (`pty_spawn`/`pty_write`/`pty_resize`/`pty_kill` + output channel) doesn't change.
- Keep the frontend talking to that stable command/channel surface — never let it assume the PTY is
  in-process.
- That's it. Don't build the daemon, the socket, or the parser in v1 — just don't foreclose them.

### A.7 Effort & risk

| Item                                            | Effort | Note                                                              |
| ----------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Client/daemon split + framed socket IPC         | Medium | Plumbing; well-trodden. Windows named-pipe path adds a little     |
| Headless screen model + attach/replay           | Medium | The real work; use `wezterm-term`/`alacritty_terminal`, don't DIY |
| Multi-client resize semantics                   | Small  | Copy tmux's smallest-wins rule                                    |
| Daemon lifecycle/supervision (spawn, auto-exit) | Small  | Pidfile + socket discovery + refcount                             |
| Remote via wrapped `tmux`/`mosh`                | Small  | It's just a shell command; no daemon of our own                   |

| Risk                                            | Mitigation                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Screen-model divergence from real terminal      | Reuse a battle-tested VT crate; snapshot-and-replay, don't hand-roll                                |
| Orphaned daemon / stale socket                  | Pidfile + liveness check on GUI launch; daemon auto-exits when idle                                 |
| Scrollback memory growth in a long-lived daemon | Cap scrollback per session (same policy as §13)                                                     |
| Scope creep (this is a whole subsystem)         | Strictly post-v1; v1 only pays the [A.6](#a6-what-to-do-in-v1-so-this-stays-cheap-later) trait cost |
