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
| **M1**    | Multi-session + layout (tabs + split panes)     | ✅ done |
| **M2**    | Agent-runner headline (notifications + status)  | ✅ done |
| **M3**    | Polish (search, clipboard, themes, persistence) | ⬜ next |
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

## M1 — Multi-session + layout ✅ _(implemented; interactive + WSL checks pending)_

**Goal:** turn the single terminal into a real workspace: many sessions, tabs, resizable split
panes, per-OS shell selection incl. WSL. This is the structural milestone.

| ID  | Feature                       | Description                                                                                                                      | Status                                     |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| —   | **Session store**             | Zustand store: `sessions` map + per-tab **pane tree** + active tab/pane. PTY lifecycle driven by store actions, not mount timing | ✅                                         |
| —   | **`<TerminalPane>` refactor** | Terminal lives in `TerminalManager` (outside React tree) so splits/tab-switches re-attach instead of respawning                  | ✅                                         |
| F2  | **Tabs**                      | Create / close / rename tabs                                                                                                     | 🚧 create/close/rename ✅; reorder later   |
| F14 | **Split panes**               | Split active pane H/V (react-resizable-panels v4); resizable dividers; close pane; focus-on-click; per-pane fit → `pty_resize`   | ✅                                         |
| F3  | **Cross-platform shells**     | Per-OS default shell resolution (zsh/bash/PowerShell)                                                                            | ✅                                         |
| F4  | **WSL sessions**              | On Windows, spawn `wsl.exe [-d <distro>]`; enumerate distros via `wsl.exe -l -q`                                                 | ✅ coded, **untested (no Windows access)** |
| —   | **`list_shells()` command**   | Rust command returning available shells/distros for the picker                                                                   | ✅                                         |
| F12 | **Session titles**            | Manual tab rename (double-click)                                                                                                 | 🚧 rename ✅; OSC 0/2 auto-title later     |
| —   | **Lifecycle hardening**       | Kill all child PTYs on window close (no orphaned shells)                                                                         | ✅ (`on_window_event`)                     |

**Exit criteria:** open ≥3 sessions across tabs + a split; each is an independent shell; resizing
any pane reflows only that pane; closing the window leaves no orphaned shell processes; WSL tab
works on a Windows box (or documented as untested if no Windows access yet).

**Verified:** lint + 16 frontend tests + Rust suite green; app builds and launches (~82 MB).
**Pending:** hands-on interactive check (tabs/splits/shell-preservation); WSL on a real Windows box.

**Key risks (addressed):** resize wiring across N panes; focus management; background-mounted
terminals — solved by decoupling terminal lifetime from the React tree via `TerminalManager`.

---

## M2 — Agent-runner headline features ✅ _(implemented; notification delivery needs signed build to fully verify on macOS)_

**Goal:** the part that makes smterm _cmux-like_ rather than "just a terminal" — know when a
session needs attention and tell the user via native notifications.

| ID  | Feature                          | Description                                                                                                                 | Status                                      |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| F6  | **Native notifications**         | `tauri-plugin-notification`; toast on OSC 9 when the session's tab isn't visible                                            | ✅ (macOS delivery needs signed build — M4) |
| —   | **OSC 9 handler**                | xterm OSC 9 handler — `printf '\e]9;msg\a'` raises a toast + attention badge                                                | ✅                                          |
| F15 | **Per-session status/attention** | `idle / working / attention` via OSC 133 + OSC 9; badges on tabs + panes                                                    | ✅ (working/idle/attention)                 |
| —   | **Status detection**             | Auto shell-integration (zsh + bash) injects OSC 133;C/D → working/idle with no user setup; OSC 9 = attention; output→unread | ✅ (fish/pwsh/WSL later)                    |
| —   | **Focus-aware delivery**         | Notify/flag only when the session's tab isn't visible (window focus + active tab)                                           | ✅                                          |
| F16 | **Session overview**             | Tab badges (attention/working/unread) + per-pane status dot                                                                 | ✅ badges; glance grid later                |

**Exit criteria:** an agent finishing/attention in a background tab raises a native notification;
the tab shows a badge; no notification spam for the visible tab.

**Verified:** lint + 21 frontend tests (incl. status reducer/badge) + Rust suite green; app builds
and launches (~86 MB); focus-aware logic unit-tested.
**Pending:** hands-on check of OSC 9 toast + badges; macOS notification _delivery_ typically needs a
signed/bundled app (`make build`), so dev-mode toasts may not appear even though the path is wired.

**Deferred:** "waiting-for-input" detection (needs deeper shell integration); notification
click → focus specific pane (cross-platform action routing); session glance/grid view.

---

## M3 — Polish ⬜ _(next)_

**Goal:** the quality-of-life layer that makes it pleasant daily — led by **file-first settings**.

### M3a — Settings, fonts & themes (next up)

**Design — one source of truth, two editors:** `~/.config/smterm/settings.json` (`%APPDATA%\smterm\`
on Windows) is authoritative and hand-editable. A GUI settings panel and manual edits both write
the same file; a live file watcher re-applies on any change. The panel is just a friendlier editor.

Locked decisions (2026-07-06): **canvas renderer + ligatures** (no WebGL); **live file watcher**;
v1 scope = font + theme + core (plain form, shadcn/Tailwind deferred). Default font **JetBrains Mono**.

Example `settings.json`:

```jsonc
{
  "font": { "family": "JetBrains Mono", "size": 13, "ligatures": true, "lineHeight": 1.2 },
  "theme": "dark",
  "cursorBlink": true,
  "scrollback": 5000,
}
```

| ID  | Feature               | Description                                                                                                   | Status                     |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| —   | **Schema + defaults** | Typed settings + pure `mergeSettings` + tolerant `parseSettings` (bad JSON → defaults)                        | ✅                         |
| —   | **File layer (Rust)** | `~/.config/smterm/settings.json`; read/write commands; `notify` watcher → `settings-changed`; open in editor  | ✅                         |
| —   | **Load + apply**      | Load on startup, subscribe to `settings-changed`, `TerminalManager.applySettings()` updates all live panes    | ✅                         |
| F13 | **Fonts + ligatures** | Bundle JetBrains Mono (OFL); canvas renderer + custom character-joiner ligatures; family/size/lineHeight      | ✅ (visual verify pending) |
| F13 | **Theme tokens**      | CSS variables (dark/light) as source → derived xterm theme; `theme` switches UI + terminal                    | ✅ (dark/light)            |
| —   | **Settings panel**    | Gear-icon panel editing the same file (writes via `write_settings_file`) + "Open settings.json" button + path | ✅                         |

**Verified:** lint + 22 Rust + 32 frontend tests green (incl. merge/validation, ligature-joiner,
config-path); app builds + launches (~123 MB with canvas renderer). **Pending:** visual check that
JetBrains Mono ligatures render and that hand-editing settings.json applies live.

**Notes:** dropped `@xterm/addon-ligatures` (Node-only `font-finder` dep breaks the webview bundle);
ligatures done via a small custom character-joiner on the canvas renderer. Pinned to the xterm 5.5
ecosystem (v6 addons not yet available).

**Risks (addressed):** ligatures ↔ renderer (canvas + custom joiner); live font/size change
re-`fit()`s + `pty_resize`s all panes.

### M3b — Remaining polish (after settings)

| ID  | Feature             | Description                                                                     | Status |
| --- | ------------------- | ------------------------------------------------------------------------------- | ------ |
| F9  | Scrollback + search | xterm scrollback + `search` addon (find in buffer)                              | ⬜     |
| F10 | Copy / paste        | Selection + clipboard; right-click / keybindings                                | ⬜     |
| F11 | Persist layout      | Save tabs / cwd / split tree to the same config; restore (fresh PTYs) on launch | ⬜     |

**Exit criteria:** hand-editing `settings.json` updates the app live; the panel edits the same file;
JetBrains Mono ligatures render; theme switches UI + terminal; relaunch restores layout; search +
copy/paste work.

**Note:** WebGL renderer dropped in favor of ligatures (canvas). Revisit only if perf demands it.

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
