# smterm

Cross-platform terminal app (agent-runner focus). Multiple shell sessions in tabs + split panes;
links open the OS browser; native notifications; per-session status. See `ARCHITECTURE.md` (design),
`ROADMAP.md` (progress), `TESTING.md` (quality bar).

## Stack

Electron (Chromium) · electron-vite · React + TypeScript · Zustand · xterm.js (WebGL renderer) ·
node-pty · react-resizable-panels · Vitest. (Migrated from Tauri/Rust — see ARCHITECTURE §3.5.)

## Structure

```
electron/
  main.ts               main process: BrowserWindow, ipcMain (pty/settings/shells/notify/links)
  preload.ts            contextBridge → window.smterm
  shell-integration.ts  inlined zsh/bash OSC-133 scripts + listShells (WSL) + buildInjection
src/
  main.tsx              renderer entry (bundles fonts)
  app.tsx               compose: tab bar + active tab's pane layout
  store.ts              Zustand: sessions + per-tab pane tree + settings + actions
  types.ts              Session, PaneNode, Tab, ShellOption
  lib/ipc.ts            typed renderer→main seam (the only backend touchpoint)
  lib/pane-tree.ts      pure split/remove/collapse/query (unit-tested)
  lib/session-status.ts pure status reducer + tab-badge aggregation (unit-tested)
  terminal/terminal-manager.ts  xterm+PTY kept OUTSIDE React, keyed by session id
  settings/            schema (merge/validate) · themes (tokens→CSS+xterm) · io
  components/          tab-bar, pane-layout, terminal-pane, settings-panel
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
