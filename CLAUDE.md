# smterm

Cross-platform terminal app (agent-runner focus). Multiple shell sessions in tabs + split
panes; links open the OS browser; native notifications planned. See `ARCHITECTURE.md` (design),
`ROADMAP.md` (progress), `TESTING.md` (quality bar).

## Stack

Tauri 2 · Rust (`portable-pty` bridge) · React + TypeScript · xterm.js · Zustand ·
react-resizable-panels · Vitest.

## Structure

```
src/
  App.tsx                  compose: tab bar + active tab's pane layout
  store.ts                 Zustand: sessions + per-tab pane tree + actions
  types.ts                 Session, PaneNode, Tab, ShellOption
  lib/paneTree.ts          pure split/remove/collapse/query (unit-tested)
  terminal/TerminalManager.ts  xterm+PTY kept OUTSIDE React, keyed by session id
  components/              TabBar, PaneLayout, TerminalPane
src-tauri/src/lib.rs       PTY bridge: pty_spawn/write/resize/kill, list_shells
src-tauri/tests/pty.rs     integration tests vs a real shell
```

## Commands

`make run` (dev) · `make check` (lint+test, pre-merge) · `make test` · `make lint` ·
`make fmt` · `make build` (bundle). `make help` lists all.

## Conventions

- **Docstrings**: one short line on non-obvious functions/types — scannable, not verbose.
- **Commits**: semantic (`feat:`, `fix:`, `chore:`, `docs:`), imperative, scope like `fix(M1):`.
- **Tests (with the feature, not after)**: extract logic into pure functions and test those
  exhaustively — edge cases, not just the happy path. **Rust especially**: the compiler proves it
  builds, not that it's correct, so every new command/behavior gets a test; prefer real integration
  tests (spawn an actual shell/PTY) over mocks; work through the PTY edge-case catalog in
  TESTING.md §3b (resize, UTF-8 boundaries, isolation, no orphans). Rust changed with no test = incomplete.
- **Lint is a gate**: clippy `-D warnings`, strict `tsc`, eslint, prettier — all green before
  commit (pre-commit hook enforces it). Run `make fmt` first.
- Keep the Rust surface small; put app logic in TypeScript.

## Gotchas

- No `window.prompt/alert/confirm` in the Tauri webview — use inline UI.
- Terminals live in `TerminalManager` (not the React tree) so splits/tab-switches re-attach
  instead of respawning shells. Dispose only when a session leaves the store.
- `make` puts cargo on PATH; a bare `npm run tauri dev` needs `source ~/.cargo/env` first.
- On Windows, the app spawns `wsl.exe` as a shell — it never runs _inside_ WSL.
