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

One-line landmine flags; full _why_ + fixes in **`GOTCHAS.md`** (anchors below). Main-process
rules also in `electron/CLAUDE.md` (loaded on demand). Design detail in `ARCHITECTURE.md`.

- **Renderer ↔ main only via `src/lib/ipc.ts`** (preload `window.smterm`); no Electron in React.
  Terminals live in `terminal-manager.ts`, outside React (re-attach, don't respawn). → GOTCHAS #seam
- **Terminal fonts must be bundled `@font-face`**; load explicitly before the WebGL atlas builds.
  Ligatures (WebGL-only) default **off**. → GOTCHAS #fonts
- **WebGL for the focused pane only** (`auto`, default); many contexts garble the atlas. `renderer`
  setting = `auto`|`dom` (`lib/renderer-policy.ts`). **Don't animate compositing on a WebGL pane.** → GOTCHAS #renderer
- **cwd is OSC-7-based** (drives diff panel + split/new-tab inheritance); no OSC 7 → `$HOME`. → GOTCHAS #session-survival
- **Layout persisted, processes not across a full quit** (workspace.json restore). **But PTYs
  survive a renderer reload** via attach-or-spawn reattach. Full-quit survival = ROADMAP M5. → GOTCHAS #session-survival
- **Quit is guarded** (`before-quit` confirm dialog when PTYs live). → GOTCHAS #session-survival
- **A crashed TUI's mouse mode self-heals** via the zsh/bash `precmd` reset. → GOTCHAS #mouse-reset
- **zsh/bash history is shared across panes** — integration sets `SHARE_HISTORY`/`histappend`
  (incremental write → also survives close); opt-out via `shareHistory` setting. → GOTCHAS #history
- **`node-pty` is a native module** — `npx electron-rebuild -o node-pty`; not unit-testable in Vitest. → GOTCHAS #node-pty
- **On Windows the app spawns `wsl.exe`** — never runs _inside_ WSL. → GOTCHAS #windows
- **Agent-status reducer has a known flaw** — don't quick-patch (needs a test matrix). → GOTCHAS #agent-status, ARCHITECTURE §9a
