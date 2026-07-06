# smterm — Roadmap & Feature Tracker

Living document. Update status as we go. Companion to [ARCHITECTURE.md](./ARCHITECTURE.md)
(design/decisions) and [TESTING.md](./TESTING.md) (quality bar).

**Status legend:** ✅ done · 🚧 in progress · ⬜ todo · 🧊 deferred

**Feature IDs** (F#) match ARCHITECTURE.md §5.

---

## Milestone status at a glance

| Milestone | Theme                                           | Status  |
| --------- | ----------------------------------------------- | ------- |
| **M0**    | Spike: core stack works end-to-end              | ✅ done |
| **M1**    | Multi-session + layout (tabs + split panes)     | ⬜ next |
| **M2**    | Agent-runner headline (notifications + status)  | ⬜      |
| **M3**    | Polish (search, clipboard, themes, persistence) | ⬜      |
| **M4**    | Packaging & signed cross-platform builds        | ⬜      |
| **M5**    | Later (auto-update, session reattach)           | 🧊      |

---

## M0 — Spike ✅

**Goal:** prove the whole stack works — one xterm.js terminal talking to a real shell via
`portable-pty`, cross-platform foundation in place. **Done & committed (`d6419bd`).**

| ID  | Feature                   | Description                                                                     | Status                            |
| --- | ------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| F1  | PTY-backed terminal       | Real interactive shell; full-screen TUIs work (vim/top)                         | ✅                                |
| —   | PTY bridge (Rust)         | `pty_spawn / pty_write / pty_resize / pty_kill`, reader thread → `ipc::Channel` | ✅                                |
| F5  | Clickable links → browser | `web-links` addon → `openUrl` opens OS default browser                          | ✅                                |
| F7  | Resize handling           | `fit` addon + `ResizeObserver` → `pty_resize`                                   | ✅                                |
| F8  | Rendering                 | xterm.js default renderer, dark theme, monospace                                | ✅ (WebGL upgrade deferred to M3) |

**Exit criteria (all met):** builds clean (`cargo check` + `tsc`), launches (~85 MB RAM),
interactive shell confirmed by hand.

---

## M1 — Multi-session + layout ⬜ _(next)_

**Goal:** turn the single terminal into a real workspace: many sessions, tabs, resizable split
panes, per-OS shell selection incl. WSL. This is the structural milestone.

| ID  | Feature                       | Description                                                                                                                      | Status |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| —   | **Session store**             | Zustand store: `sessions` map + per-tab **pane tree** + active tab/pane. PTY lifecycle driven by store actions, not mount timing | ⬜     |
| —   | **`<TerminalPane>` refactor** | Reusable component keyed by `sessionId`; stays mounted in background for instant switching                                       | ⬜     |
| F2  | **Tabs**                      | Create / close / rename / reorder tabs                                                                                           | ⬜     |
| F14 | **Split panes**               | Split current pane H/V; resizable dividers; close pane; focus-follows-click. Each pane resize → fit → `pty_resize`               | ⬜     |
| F3  | **Cross-platform shells**     | Per-OS default shell resolution (zsh/bash/PowerShell)                                                                            | ⬜     |
| F4  | **WSL sessions**              | On Windows, spawn `wsl.exe [-d <distro>]`; enumerate distros via `wsl.exe -l -q`                                                 | ⬜     |
| —   | **`list_shells()` command**   | Rust command returning available shells/distros for the "New ▾" picker                                                           | ⬜     |
| F12 | **Session titles**            | Track OSC 0/2 title escapes; manual rename                                                                                       | ⬜     |
| —   | **Lifecycle hardening**       | Kill all child PTYs on window close (no orphaned shells)                                                                         | ⬜     |

**Exit criteria:** open ≥3 sessions across tabs + a split; each is an independent shell; resizing
any pane reflows only that pane; closing the window leaves no orphaned shell processes; WSL tab
works on a Windows box (or documented as untested if no Windows access yet).

**Key risks:** resize wiring across N panes; focus management; background-mounted terminals.

---

## M2 — Agent-runner headline features ⬜

**Goal:** the part that makes smterm _cmux-like_ rather than "just a terminal" — know when a
session needs attention and tell the user via native notifications.

| ID  | Feature                          | Description                                                                                | Status |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| F6  | **Native notifications**         | `tauri-plugin-notification`; fire OS toast on trigger; click focuses the session's pane    | ⬜     |
| —   | **OSC 9 handler**                | Register xterm OSC handler so any program/agent can `printf '\e]9;msg\a'` to raise a toast | ⬜     |
| F15 | **Per-session status/attention** | Derive `working / waiting-for-input / idle / done`; badges on tabs + panes                 | ⬜     |
| —   | **Status detection spike**       | Blend of OSC 133 prompt marks + OSC 9 + output-idle heuristic (see ARCHITECTURE §14 #6)    | ⬜     |
| —   | **Focus-aware delivery**         | Only notify when window/tab unfocused; suppress for the active pane                        | ⬜     |
| F16 | **Session overview**             | Tab bar status badges + optional glance view of all sessions                               | ⬜     |

**Exit criteria:** an agent finishing a task in a background tab raises a native notification;
clicking it focuses that pane; the tab shows a "done/attention" badge; no notification spam for
the focused pane.

**Open decisions to resolve here:** notification triggers to ship first (rec: OSC 9 + unfocused
activity), and the status-detection strategy.

---

## M3 — Polish ⬜

**Goal:** the quality-of-life layer that makes it pleasant daily.

| ID  | Feature             | Description                                                                         | Status |
| --- | ------------------- | ----------------------------------------------------------------------------------- | ------ |
| F9  | Scrollback + search | xterm scrollback + `search` addon (find in buffer)                                  | ⬜     |
| F10 | Copy / paste        | Selection + clipboard; right-click / keybindings                                    | ⬜     |
| F8+ | WebGL renderer      | `@xterm/addon-webgl` (canvas fallback) for perf                                     | ⬜     |
| F13 | Themes / fonts      | Theme object + font family/size in settings                                         | ⬜     |
| F11 | Persist layout      | Save tabs / cwd / split tree / prefs to config JSON; restore (fresh PTYs) on launch | ⬜     |
| —   | Settings UI         | Minimal preferences panel                                                           | ⬜     |

**Exit criteria:** relaunch restores the tab/split layout at the right cwds; search, copy/paste,
theme switching all work; large output stays smooth with WebGL.

---

## M4 — Packaging & distribution ⬜

**Goal:** installable, signed apps on all four targets.

| Task                | Description                                                                             | Status |
| ------------------- | --------------------------------------------------------------------------------------- | ------ |
| macOS bundle        | `.dmg`/`.app`, **codesign + notarize** (needed for reliable notifications/Gatekeeper)   | ⬜     |
| Windows bundle      | `.msi`/`.exe`; set **AppUserModelID** (required for toasts); optional code-signing cert | ⬜     |
| Linux bundle        | `.deb` / `.rpm` / **AppImage**                                                          | ⬜     |
| CI release pipeline | GitHub Actions matrix building/signing all targets on tag                               | ⬜     |

**Exit criteria:** a tagged release produces installers for mac/Win/Linux; a fresh install runs and
delivers a notification (proving app identity is set up correctly).

**Reality check:** signing/notarization is the most tedious part of the project — budget for it.

---

## M5 — Later 🧊

| Feature                   | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| Auto-update               | `tauri-plugin-updater` with signing keys                                          |
| Session reattach          | Survive app restart via a detached backend (daemon or tmux/zellij under the hood) |
| Advanced status detection | Deeper shell integration for precise agent-state tracking                         |
| Splits polish             | Drag-to-rearrange panes, saved layouts/presets                                    |

---

## Definition of done (applies to every feature)

A feature is ✅ only when:

1. Implemented and manually verified in the running app.
2. **Rust logic** covered by unit/integration tests where it has behavior (see TESTING.md).
3. **Frontend logic** (store ops, parsers) covered by unit tests; UI by component tests where it matters.
4. `cargo fmt` + `cargo clippy -D warnings` + `eslint` + `tsc` all clean.
5. Cross-platform impact considered (even if a platform is only tested in CI).
