# smterm

Cross-platform terminal app (agent-runner focus). Multiple shell sessions in tabs + split panes;
links open the OS browser; native notifications; per-session status. See `ARCHITECTURE.md` (design),
`ROADMAP.md` (progress), `TESTING.md` (quality bar).

## Stack

Electron (Chromium, **frameless**) · electron-vite · React + TypeScript · Zustand · xterm.js (WebGL
renderer) · node-pty · react-resizable-panels · Vitest. UI: `@phosphor-icons/react`, bundled **Geist
Mono** (chrome) + FiraCode/JetBrains Mono (terminal). Visual design = `mux` (see design_handoff +
ROADMAP M3.5). (Migrated from Tauri/Rust — see ARCHITECTURE §3.5.)

## Structure

```
electron/
  main.ts               main process: frameless BrowserWindow, ipcMain (pty/settings/shells/notify/links/window-controls/platform/git)
  preload.ts            contextBridge → window.smterm
  shell-integration.ts  inlined zsh/bash OSC-133 + OSC-7 (cwd) scripts + listShells (WSL) + buildInjection
  git.ts                main-process git status/diff (pure parsers, unit-tested) for the changes panel
src/
  main.tsx              renderer entry (bundles fonts)
  app.tsx               compose: tab bar + active tab's pane layout
  store.ts              Zustand: sessions + per-tab pane tree + settings + actions
  types.ts              Session, PaneNode, Tab, ShellOption
  lib/ipc.ts            typed renderer→main seam (the only backend touchpoint)
  lib/pane-tree.ts      pure split/remove/collapse/query (unit-tested)
  lib/session-status.ts pure status reducer + tab-badge aggregation (unit-tested)
  lib/status-ui.ts      status → dot colour/word/pulse (shared by sidebar/status/pane)
  lib/session-label.ts  title (rename/OSC/cwd) + shell badge + branch•cwd sublines (pure, tested)
  lib/shells.ts         resolve the default shell from settings (pure, tested)
  lib/use-active-cwd.ts hook: focused session's cwd (OSC-7 tracked) → git panel/status bar
  terminal/terminal-manager.ts  xterm+PTY kept OUTSIDE React, keyed by session id
  settings/            schema (merge/validate) · themes (tokens→CSS+xterm) · io
  components/          top-bar, sidebar, status-bar, command-palette, diff-panel, pane-layout, terminal-pane, settings-panel
```

## Commands

`make run` (dev) · `make check` (lint+test) · `make test` · `make lint` · `make fmt` ·
`make build` · `make install` (deps + electron-rebuild + hooks). `make help` lists all.

## Conventions

- **Filenames: kebab-case** (`terminal-manager.ts`); component _exports_ stay PascalCase.
- **No semicolons** (Prettier `semi: false`).
- **Docstrings**: one short line on non-obvious functions/types — scannable, not verbose.
- **Commits**: semantic (`feat:`, `fix:`, `chore:`, `docs:`), imperative.
- **Tests with the feature**: push logic into pure functions (pane-tree, session-status,
  shell-integration parsers) and test those; the risky code earns real tests.
- **Lint is a gate** (pre-commit hook): `tsc` (renderer + electron), eslint, prettier. Run `make fmt` first.

## Gotchas

- **Renderer ↔ main only via `src/lib/ipc.ts`** (preload `window.smterm`). Don't import Electron in
  React. This seam is also the insulation point for a future out-of-process session daemon (ARCHITECTURE Appendix A).
- **Terminal fonts must be bundled `@font-face`** (`public/fonts/`); the WebGL renderer needs the
  primary font to carry Nerd/Powerline icons (no per-glyph fallback).
- Terminals live in `terminal-manager.ts` (not the React tree) so splits/tab-switches re-attach
  instead of respawning shells. Dispose only when a session leaves the store.
- **`node-pty` is a native module** — after install / Electron upgrades run `npx electron-rebuild -o node-pty`
  (in `make install`). Vitest can't load it (Electron ABI), so PTY spawning isn't unit-tested there.
- Ligatures need `allowProposedApi` + the character joiner (works on WebGL, not the DOM renderer).
- On Windows the app spawns `wsl.exe` as a shell — it never runs _inside_ WSL.
- **cwd tracking is OSC-7-based.** `session.cwd` is set only when the shell emits OSC 7 (our
  zsh/bash integration does, from `precmd`). It drives the **git diff panel** and **cwd inheritance**
  (splits + new tabs open in the focused terminal's dir). Shells that don't emit OSC 7 (plain
  PowerShell/cmd, or before the first prompt) have no cwd → the diff panel is empty and new panes
  fall back to `$HOME`. Not a bug — graceful degradation.
- **Layout is persisted, processes are not.** The tab/pane tree + each pane's `{command,args,cwd}` are
  saved (debounced) to `~/.config/smterm/workspace.json` and **restored on launch** (VS Code-style:
  fresh shells respawn in the saved cwds — scrollback/running programs are gone). True reattach (live
  processes surviving a quit, via a detached daemon) is still ROADMAP M5.
- **Quit is guarded.** `before-quit` shows a native confirm dialog when PTYs are live (unless
  `settings.confirmQuit` is false); the frameless close button routes through `app.quit()` too. The
  dialog's "don't warn again" writes `confirmQuit:false` to settings.json.
- **Renderer is auto-managed (WebGL only for on-screen panes).** Many simultaneous WebGL contexts
  corrupt the glyph atlas (garbled text — xterm.js #4379/#3303). `terminal-manager.reconcileRenderers()`
  gives WebGL only to the active tab's panes, and only when ≤ `MAX_WEBGL_PANES` (4) are visible; else
  DOM. Background tabs release their context (PTY keeps running). Policy = pure `lib/renderer-policy.ts`
  (tested); called on tab-switch/split/close (app.tsx) + attach. No renderer setting — it's automatic.
- **Don't animate compositing properties on a pane that holds the WebGL canvas.**
  A `box-shadow`/`transform`/opacity animation on `.terminal-pane` (e.g. the removed "attention flash")
  can leave the child xterm **WebGL canvas showing stale/garbled glyphs** — only the animated pane
  corrupts. Any per-pane attention cue must avoid animating the terminal's container (use the sidebar
  dot/bell, or a non-compositing indicator). Renderer stays **WebGL** (VS Code's choice; xterm's
  canvas addon is deprecated).
- **Agent-status reducer has a known flaw** (`lib/session-status.ts`): `running` = OSC-133 C..D
  (process alive) ≠ actively working, so interactive agents read "running" while waiting, and
  revisiting a pane can re-notify. Don't quick-patch it — the planned activity-based + latched rewrite
  needs a real test matrix. See ARCHITECTURE §9a + ROADMAP M3.6 Track C.
