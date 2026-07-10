# Gotchas — smterm

The non-obvious traps, with the _why_. CLAUDE.md carries a one-line flag for each of
these; this file is the detail you read when one bites. See also `ARCHITECTURE.md`
(design) and `TESTING.md` (quality bar).

## Renderer ↔ main seam {#seam}

Renderer talks to main **only via `src/lib/ipc.ts`** (preload exposes it as
`window.smterm`). Don't import Electron in React. This one seam is also the insulation
point for the out-of-process session daemon (ARCHITECTURE Appendix A).

Terminals live in **`terminal/terminal-manager.ts`, OUTSIDE the React tree**, keyed by
session id — so splitting a pane or switching tabs **re-attaches** instead of respawning
the shell. Dispose a terminal only when its session leaves the store.

## Fonts & ligatures {#fonts}

Terminal fonts must be **bundled `@font-face`** (`public/fonts/`): the WebGL renderer
needs the primary font to carry Nerd/Powerline icons (no per-glyph fallback). The WebGL
atlas rasterizes glyphs via canvas, which only uses an `@font-face` **after it's
explicitly loaded** — `document.fonts.ready` is not enough (see `ensureFontLoaded`).

Ligatures need `allowProposedApi` + the character joiner (works on WebGL, not the DOM
renderer). Default is **off** (`font.ligatures: false`) — WebGL + the ligature joiner
can leave paint remnants (xterm.js #3303), worse with multiple panes.

## Renderer policy: WebGL only for on-screen panes {#renderer}

Many simultaneous WebGL contexts **corrupt the glyph atlas** (garbled text — xterm.js
#4379/#3303). `terminal-manager.reconcileRenderers()` gives WebGL only to the active
tab's panes, and only when ≤ `MAX_WEBGL_PANES` (4) are visible; otherwise DOM.
Background tabs release their context (PTY keeps running) and re-acquire on return.
Policy is the pure, tested `lib/renderer-policy.ts`; called on tab-switch/split/close
(app.tsx) + attach. There is **no renderer setting** — it's automatic.

**Don't animate compositing properties** (`box-shadow`/`transform`/opacity) on a pane
that holds the WebGL canvas (`.terminal-pane`): it can leave the child xterm WebGL
canvas showing **stale/garbled glyphs** — only the animated pane corrupts. Any per-pane
attention cue must avoid animating the terminal's container (use the sidebar dot/bell,
or a non-compositing indicator). Renderer stays WebGL (VS Code's choice; xterm's canvas
addon is deprecated).

## Self-heal a crashed TUI's mouse mode {#mouse-reset}

A full-screen TUI killed abnormally (classic case: an agent dying on lid-close/sleep)
never restores the mouse-tracking modes it enabled, so afterwards every mouse move
floods the prompt with raw SGR reports (`35;70;25M…`). Our zsh/bash `precmd`
(`electron/shell-integration.ts`) emits the mouse-mode disables (`\e[?1000/1002/1003/
1006 l`) every prompt, so the terminal self-heals the instant control returns to the
shell — safe there since no full-screen program is running. Only heals in shells with
our integration (zsh/bash); plain PowerShell/cmd/fish won't self-heal.

## Sessions, cwd & PTY lifetime {#session-survival}

**cwd tracking is OSC-7-based.** `session.cwd` is set only when the shell emits OSC 7
(our zsh/bash integration does, from `precmd`). It drives the **git diff panel** and
**cwd inheritance** (splits + new tabs open in the focused terminal's dir). Shells that
don't emit OSC 7 (plain PowerShell/cmd, or before the first prompt) have no cwd → the
diff panel is empty and new panes fall back to `$HOME`. Not a bug — graceful degradation.

**Layout is persisted, processes are not — across a full quit.** The tab/pane tree +
each pane's `{command,args,cwd}` are saved (debounced) to `~/.config/smterm/
workspace.json` and restored on launch (VS Code-style: fresh shells respawn in the saved
cwds; scrollback/running programs are gone).

**But PTYs survive a renderer reload (sleep/dev-HMR/GPU-crash).** PTYs live in the main
process, which outlives a renderer reload. `pty:spawn` is **attach-or-spawn**: a spawn
for an already-live session id **reattaches** — main rebinds output to the new renderer,
resizes, and replays recent history from a bounded per-session `OutputBuffer` — instead
of respawning and orphaning the live shell. Diagnosed via `electron/diagnostics.ts`
(a lid-close showed suspend→resume with no app reboot, only a renderer reload). Explicit
`pty:kill` (pane/tab close) still truly terminates + frees the buffer.

**True reattach across a full app quit** (live processes surviving a quit, via a detached
daemon) is still **ROADMAP M5** — a full quit kills PTYs (they're children of main +
`killAllPtys()`). See ARCHITECTURE Appendix A.

**Quit is guarded.** `before-quit` shows a native confirm dialog when PTYs are live
(unless `settings.confirmQuit` is false); the frameless close button routes through
`app.quit()` too. The dialog's "don't warn again" writes `confirmQuit:false` to
settings.json.

## zsh/bash history is shared across panes (cmux-like) {#history}

**Fixed 2026-07-10.** Symptom was: unlike cmux, smterm panes didn't share command history
live (type in pane A, reuse in pane B) and history often didn't survive closing the app —
even with the user's `HISTFILE`/`HISTSIZE`/`SAVEHIST` set (so `.zshrc` **was** loading;
never an rc-loading problem). Root cause: our injected integration didn't enable shared
history, while cmux does (confirmed — `setopt | grep -i sharehistory` returns `sharehistory`
in a cmux pane with the user's `.zshrc` having it off, so cmux enables it itself).

**Fix (in `electron/shell-integration.ts`):**

- **zsh:** after sourcing the user's `.zshrc` (so it wins), `setopt SHARE_HISTORY` + sane
  `HISTFILE`/`SAVEHIST`/`HISTSIZE` fallbacks **only when unset**.
- **bash:** `shopt -s histappend` + `history -a; history -n` in `__smterm_precmd` (after
  `local ret=$?` so it can't clobber the reported exit code).
- **Why it also fixes persistence:** `SHARE_HISTORY`/`histappend` write each command to
  `HISTFILE` **immediately**, so history survives even the hard `proc.kill()` on close — we
  did **not** need to touch the PTY kill/reattach lifecycle (which session-survival depends
  on). Graceful shutdown would be a nice-to-have but is unnecessary for history.
- **Opt-out:** it's an opinionated semantics change (cross-pane chronological interleave vs
  per-session order), so it's gated on `SMTERM_SHARE_HISTORY` (default on). The
  `shareHistory` setting (schema, default `true`) → `main.ts` sets `SMTERM_SHARE_HISTORY=0`
  in the spawn env when off; `wslInjection` lists the var in `$WSLENV` so the opt-out
  crosses into WSL.
- **Invariant:** all panes must keep the **same `HISTFILE`** — the injection must never set
  a per-pane histfile, or sharing breaks.

## node-pty is a native module {#node-pty}

After install / Electron upgrades run `npx electron-rebuild -o node-pty` (in
`make install`). Vitest can't load it (Electron ABI), so PTY spawning isn't unit-tested
there — push logic into pure modules (`output-buffer`, `coalescer`, shell-integration
parsers) and test those; verify the PTY path manually / via the diagnostics log.

## GUI launch has a bare PATH — import the login-shell env {#shell-env}

A macOS/Linux app launched from Finder/Dock inherits a minimal `launchd` PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`), **not** the user's shell PATH — so Homebrew/cargo
tools (`starship`, etc.) are missing and `.zshrc` lines like `starship init` fail with
"command not found". Only bites the **packaged** app; `npm run dev` is launched from a
terminal that already has the full env. Fix (`electron/shell-env.ts`, VS Code's approach):
on startup, when `app.isPackaged` and not Windows, run the login+interactive shell once,
capture its env, and import PATH (+ missing vars) into `process.env` before any PTY
spawns. Parser is pure + tested; the shell probe is best-effort (returns `{}` on failure).

## Windows {#windows}

The app spawns `wsl.exe` as a shell — it never runs _inside_ WSL.

**Git for a WSL session runs _inside_ the distro, not on the host.** A WSL pane's cwd
(from OSC 7) is a Linux path (`/home/you/repo`) the Windows host can't see, so host `git`
reports "not a git repo" and the diff panel is empty. Fix: the renderer passes the session's
WSL context (`lib/wsl.ts` `wslContext` → `{ distro }`, parsed from the `wsl.exe -d <distro>`
command) with `git:status`/`git:diff`; `electron/git.ts` then runs `wsl.exe [-d <distro>]
--cd <cwd> -- git …` (see `wslGitArgs`). The untracked-file line-count fallback (`countLines`,
host fs) and the diff null-device (`NUL` vs `/dev/null`) are also WSL-aware.

## Clickable file links {#file-links}

Path-like tokens in output are made clickable (Cmd/Ctrl-click → open in editor). Detection is
a **permissive regex on purpose** (`lib/file-links.ts`, pure + tested) — the real false-positive
filter is **existence validation** (`fs:path-exists`, `main`) against the session cwd, so a version
string like `1.2.3` or a domain that doesn't resolve to a file never underlines. Validation is
cached in `terminal-manager` (the link provider fires on hover, not per render). Clicking runs the
`openPath` template (default `code -g {file}:{line}:{col}`, found via the login-shell PATH from
`shell-env` so a packaged app can locate `code`); it falls back to the OS default (`shell.openPath`)
when the template is empty or the editor binary isn't found. **Known limits (follow-ups):** single
row only (a path wrapped across rows isn't matched); forward-slash paths (no Windows-native
backslash); extensionless files (`Makefile`) unless they contain a slash; **WSL** panes don't open
links yet (needs the WSL cwd context — see `#windows` / the WSL git PR).

## Agent-status reducer has a known flaw {#agent-status}

`lib/session-status.ts`: `running` = OSC-133 C..D (process alive) ≠ actively working, so
interactive agents read "running" while waiting, and revisiting a pane can re-notify.
Don't quick-patch it — the planned activity-based + latched rewrite needs a real test
matrix. See ARCHITECTURE §9a + ROADMAP M3.6 Track C.
