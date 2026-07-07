# Handoff: mux — Cross-Platform Terminal + Agent Multiplexer

## Overview

`mux` is a cross-platform terminal application (Windows/WSL + Linux + macOS) built around a
terminal **multiplexer** and **AI-agent orchestration**. It lets a user run multiple terminal
sessions, each hosting one or more AI agents (and a human shell) working in parallel, with:

- A **session/agent tree** to see every agent and its state at a glance (running / waiting / idle).
- A **split-pane terminal grid** for the active session.
- A **live git-style diff panel** showing files each agent (or the human) is changing in real time,
  with per-file authorship.
- **Notifications & approvals** — agents request permission before running sensitive commands, and
  notify on completion / failure.
- A **command palette** (`⌘K`) to spawn agents, switch sessions, split panes, and change themes.
- **Theme customization** (default minimal-dark, plus Tokyo Night / Catppuccin / Gruvbox).

This is the hero screen of the app.

## About the Design Files

The file in this bundle (`Mux.dc.html`) is a **design reference created in HTML** — a high-fidelity
prototype showing intended look, layout, and behavior. **It is not production code to copy directly.**
It uses a small in-house streaming-template runtime (`<x-dc>`, `<sc-for>`, `<sc-if>`, a `Component`
logic class) purely to author the mock — ignore that runtime.

Your task is to **recreate this design in the target codebase's environment** using its established
patterns and libraries. For a cross-platform desktop terminal app, a typical stack would be
**Electron or Tauri + React/TypeScript**, with **xterm.js** for the actual terminal emulation and a
PTY backend (`node-pty`, or Rust `portable-pty` for Tauri). If no environment exists yet, choose the
most appropriate framework and implement there. Treat the HTML/CSS as the visual spec, not the source.

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, and component states are specified below
and should be recreated pixel-accurately using the codebase's libraries. The one exception: the
terminal _contents_ (command output, diff text) are illustrative sample data — real content comes from
the PTY / agent processes.

---

## Screens / Views

### Screen: Main Window (multiplexer + agent tree)

**Purpose:** The primary workspace. User monitors and drives multiple agents across sessions,
watches file changes live, and approves/denies agent actions.

**Frame:** Frameless desktop window, `100vw × 100vh`, `overflow:hidden`. Root is a vertical flex
column: **Top bar (46px) → Body (flex:1) → Status bar (28px)**. Base font `12px`,
`font-family: 'Geist Mono', ui-monospace, monospace`. `box-sizing: border-box` globally, `body { margin:0 }`.

Custom scrollbars: `9px` wide, thumb `rgba(255,255,255,0.09)` radius `6px`, transparent track.
Text selection: `background: rgba(120,200,150,0.25)`.

---

#### 1. Top Bar — height 46px

- Flex row, `align-items:center`, `gap:14px`, `padding:0 12px 0 16px`, `background: var(--panel)`,
  `border-bottom:1px solid var(--border)`.
- **Brand (left):** filled Phosphor `terminal-window` icon `16px` in `--accent`, then `mux` label
  `13px / weight 600 / letter-spacing 0.04em`.
- Vertical divider: `1px × 18px`, `var(--border)`.
- **Session tabs** (flex row, `gap:4px`, `flex:1`):
  - _Active tab_ `api-refactor`: `padding:6px 12px`, `border-radius:7px`, `background: var(--elev)`,
    `border:1px solid var(--border2)`. Contains a `7px` pulsing `--accent` dot, label `12.5px / 500`,
    and a faint count `3` (`10.5px`).
  - _Inactive tabs_ `web-ui` (faint dot, idle), `infra` (pulsing accent dot, running): `color: var(--dim)`,
    no background; hover → `background: var(--elev); color: var(--text)`.
  - **New-tab button**: `28×28`, `border-radius:7px`, Phosphor `plus` `14px`; hover → `var(--elev)`.
- **Global controls (right):**
  - Search/run pill: `padding:5px 10px`, `border:1px solid var(--border)`, `background: var(--bg)`,
    `border-radius:7px`; Phosphor `magnifying-glass` `12px` + "Search or run" `11px` + `⌘K` chip
    (`10px`, bordered, radius `4px`, `padding:1px 5px`). Hover → `border-color: var(--border2); color: var(--text)`.
  - Settings gear: `28×28`, Phosphor `gear-six` `15px`.
- Vertical divider.
- **Frameless window controls:** three `26×26` buttons, Phosphor `minus` / `square` (11px) / `x`,
  color `var(--faint)`. Hover → `var(--elev)`; the close button hover → `background: var(--red); color:#fff`.

#### 2. Body — flex row, `flex:1`, `min-height:0`

Three columns: **Sidebar (266px) · Terminal grid (flex:1) · Diff panel (388px)**.

##### 2a. Sidebar — "Sessions & agents" — width 266px

- `background: var(--panel)`, `border-right:1px solid var(--border)`, vertical flex.
- **Header (36px):** label `SESSIONS & AGENTS` (`10px / uppercase / letter-spacing 0.14em / weight 600 / var(--faint)`)
  - Phosphor `tree-structure` `14px` in `--dim`. `border-bottom:1px solid var(--border)`.
- **Tree (scrollable, `padding:6px 0`):** each row is a flex line, `gap:9px`, `padding:6px 12px 6px <indent>`,
  hover → `background: var(--elev)`. Row structure:
  - Leading icon `14px`, `width:15px`, centered, colored per node.
  - Two-line label block: primary label `12.5px` (session rows weight 600), optional sub-label
    `10.5px / var(--faint)` (both `text-overflow:ellipsis`).
  - Right meta text `10px` (status word), colored per status.
  - Trailing status dot `7×7` round, colored, pulsing when running.

  Tree data (indent = left padding):

  | indent | icon (Phosphor)       | label                  | sub-label                   | meta             | dot             |
  | ------ | --------------------- | ---------------------- | --------------------------- | ---------------- | --------------- |
  | 12px   | `caret-down` (dim)    | **api-refactor** (600) | —                           | 3 agents (faint) | none            |
  | 32px   | `robot` fill (accent) | claude                 | refactor session → jwt      | running (accent) | accent, pulsing |
  | 54px   | `flow-arrow` (dim)    | writing tests          | 24 / 31 passed              | —                | accent, pulsing |
  | 32px   | `robot` fill (amber)  | claude                 | db migrate · needs approval | waiting (amber)  | amber           |
  | 32px   | `user` fill (blue)    | you                    | interactive shell           | idle (faint)     | faint           |
  | 12px   | `caret-right` (dim)   | **web-ui** (600)       | —                           | idle (faint)     | none            |
  | 12px   | `caret-right` (dim)   | **infra** (600)        | —                           | 1 agent (faint)  | accent, pulsing |

- **Legend footer:** `border-top:1px solid var(--border)`, `padding:10px 14px`. Three inline items
  `10.5px / var(--dim)` each with a `6px` dot: ● running (accent), ● waiting (amber), ● idle (faint).

##### 2b. Terminal Grid — flex:1

Vertical flex, `gap:1px`, `background: var(--border)` (the 1px gaps render as hairline seams between panes).

- **Top row** (`flex:1.35`, flex row, `gap:1px`): two panes side by side.
- **Bottom row** (`flex:1`): one full-width pane.

**Pane shell:** `background: var(--panel)`, vertical flex, `min-width:0`.

- _Focused pane_ gets `box-shadow: inset 0 2px 0 var(--accent)` (accent top-rail). The waiting pane
  uses `inset 0 2px 0 var(--amber)`.
- **Pane header (32px):** `padding:0 10px 0 12px`, `border-bottom:1px solid var(--border)`, flex `gap:8px`.
  Filled Phosphor `robot`/`user` icon `14px` (colored by role/state) + title `11.5px / 500` +
  ` · claude` in `--faint` + a **badge** (`9.5px / uppercase / letter-spacing 0.06em`, `border:1px solid
color-mix(in srgb, <color> 40%, transparent)`, radius `4px`, `padding:1px 5px`) → `agent` (accent) /
  `shell` (dim, border `var(--border2)`) / `db-migrate` (amber). Spacer, then Phosphor
  `arrows-out-simple` `13px` (expand) in `--faint`.
- **Pane body:** `flex:1`, `padding:12px 14px`, `font-family:'JetBrains Mono', ui-monospace, monospace`,
  `font-size:12.5px`, `line-height:1.75`, `white-space:pre-wrap`. Colored spans for prompt/path
  (accent), branch (blue), command strings (amber), `●` step bullets (accent/amber), `+N` (accent),
  `−N` (red), `PASS` chip (bg accent, text `#0b0b0d`, weight 600). Blinking cursor: a `▏` glyph with
  `animation: blink 1.1s step-end infinite`. Spinner: `◜` glyph, `animation: spin 1.1s linear infinite`,
  amber.

  Pane sample content:
  - **Pane 1 (focused, agent running):** claude refactoring `session.ts` to JWT rotation — Read/Edit
    steps, `+6 −2`, running tests `24/31 passed`.
  - **Pane 2 (human shell):** `git status` output + `pnpm test auth` → `PASS`.
  - **Pane 3 (waiting on approval):** proposed command
    `npx prisma migrate dev --name jwt_sessions`, with `⚠` and keycaps `a` approve / `d` deny
    (keycap = `border:1px solid var(--border2)`, radius `4px`, `padding:0 5px`).

##### 2c. Diff Panel — width 388px (toggleable)

- `background: var(--panel)`, `border-left:1px solid var(--border)`, vertical flex.
- **Header (36px):** `CHANGES` label (same uppercase style) + summary `+58` (accent) `−3` (red)
  `· 4 files` (`11px / var(--dim)`).
- **Changed-files list** (`max-height:186px`, scrollable, `border-bottom:1px solid var(--border)`):
  each row flex `gap:9px`, `padding:6px 12px`, hover → `var(--elev)`. File icon (Phosphor `file-ts`
  blue, or `file-plus` accent for new), two-line name (`12px`) + path (`10px / faint`), then an
  **author icon** (filled `robot` accent = AI, filled `user` blue = human) with a `title` tooltip,
  then `+N` (accent) and `−N` (red).
  - `session.ts` · src/auth · claude · +6 −2 — **selected** (`background: var(--elev)`, `border-left:2px solid var(--accent)`)
  - `tokens.ts` · src/auth · claude · +12 −0
  - `verify.ts` · src/middleware · **you** · +3 −1
  - `auth.test.ts` · tests · claude (new file) · +40 −0
- **Diff header (34px):** `background: var(--bg)`, Phosphor `file-ts` blue + `session.ts` `11.5px/500`
  - `edited by claude · 20s ago` (`10px / faint` with a tiny robot icon).
- **Diff body** (scrollable, `font-family:'JetBrains Mono'`, `12px`, `line-height:1.85`): each line is
  a flex row: line-number gutter (`width:34px`, right-aligned, `10.5px`, faint) + sign gutter
  (`width:16px`, centered) + code (`white-space:pre`).
  - Added lines: `background: color-mix(in srgb, var(--accent) 13%, transparent)`, sign `+` in accent.
  - Removed lines: `background: color-mix(in srgb, var(--red) 13%, transparent)`, sign `−` in red.
  - Hunk header (`@@ … @@`): `background: color-mix(in srgb, var(--blue) 10%, transparent)`, text blue.
  - Context lines: transparent, text `var(--dim)`.

#### 3. Status Bar — height 28px

Flex row, `gap:16px`, `padding:0 14px`, `background: var(--panel)`, `border-top:1px solid var(--border)`,
`font-size:11px`, `color: var(--dim)`.

- Left: `hard-drives` icon (accent) + `WSL · Ubuntu-22.04`; `git-branch` icon + `feat/jwt-rotation`;
  `↑2 ↓0` (faint). **This platform label is where cross-platform status surfaces** (WSL / Linux / macOS).
- Spacer.
- Right: ● `2 running` (accent dot, pulsing), ● `1 waiting` (amber dot), filled `bell` icon (amber)
  - `1` badge, `UTF-8`, `14:32`.

---

### Overlays / States

#### Approval + notification toasts (bottom-right, toggleable)

`position:absolute; right:18px; bottom:40px; width:352px`, vertical flex `gap:10px`, `z-index:30`.

- **Approval card:** `background: var(--elev)`, `border:1px solid color-mix(in srgb, var(--amber) 45%, var(--border2))`,
  `border-radius:11px`, `padding:14px`, `box-shadow:0 18px 40px -12px rgba(0,0,0,0.6)`.
  Header: filled `shield-warning` `17px` amber + "Approval needed" (`12.5px/600`) + `db-migrate` tag (`10px/faint`).
  Body copy `11.5px / var(--dim)`. Command block: `JetBrains Mono 11.5px`, `background: var(--bg)`,
  `border:1px solid var(--border)`, radius `7px`, `padding:8px 10px`.
  Buttons row (`gap:8px`): **Approve** (`flex:1`, `height:32px`, `background: var(--accent)`, text `#0b0b0d`,
  `12px/600`, Phosphor `check` bold; hover `filter:brightness(1.08)`) and **Deny**
  (transparent, `border:1px solid var(--border2)`, `color: var(--dim)`, Phosphor `x`; hover
  `border-color: var(--red); color: var(--text)`).
- **Info toast:** `background: var(--elev)`, `border:1px solid var(--border2)`, radius `11px`,
  `padding:12px 14px`, filled `check-circle` `18px` accent + "auth tests passed" (`12px/500`) +
  "infra · claude finished · 31/31 green" (`10.5px/faint`) + dismiss `x`.

#### Command palette (`⌘K`, toggleable)

`position:absolute; inset:0; z-index:50`, `background: rgba(4,4,6,0.55)`, `backdrop-filter: blur(3px)`,
centered horizontally, `padding-top:120px`.

- Card: `width:620px`, `background: var(--elev)`, `border:1px solid var(--border2)`, `border-radius:13px`,
  `box-shadow:0 30px 70px -20px rgba(0,0,0,0.75)`.
- Input row (`padding:15px 16px`, `border-bottom:1px solid var(--border)`): Phosphor `magnifying-glass`
  `16px` + placeholder `14px / var(--dim)` "Run a command, spawn an agent, switch session…" + blinking
  cursor + `esc` chip.
- Results (`padding:8px 0`, `max-height:340px`): group headers (`10px / uppercase / letter-spacing 0.14em / faint`)
  **Agents / Navigate / Appearance**; each item flex `gap:12px`, `padding:9px 16px`, Phosphor icon `16px` +
  label `13px`; hover → `background: var(--panel)`. First item **selected**:
  `background: color-mix(in srgb, var(--accent) 12%, transparent)`, `border-left:2px solid var(--accent)`,
  trailing `⏎`. Items: New agent, Spawn sub-agent, Switch session, Split pane right, Theme, Open on (WSL).

---

## Interactions & Behavior

- **Session tabs:** click to switch active session; `+` creates a new session. Active tab is filled;
  running sessions show a pulsing accent dot in the tab.
- **Agent tree:** caret rows expand/collapse sessions; clicking an agent focuses its pane. Status dot
  color + pulse reflect live state (running = pulsing accent, waiting = static amber, idle = faint).
- **Panes:** the focused pane shows the accent top-rail; expand icon maximizes a pane. A pane awaiting
  approval shows the amber rail and inline `a`/`d` keycaps (keyboard `a` approves, `d` denies).
- **Approvals:** when an agent proposes a sensitive command it (a) shows inline in its pane, (b) adds
  an amber "waiting" node in the tree, (c) raises the status-bar bell count, and (d) surfaces the
  bottom-right approval card. Approve runs the command; Deny cancels it.
- **Notifications** fire on: agent finished / needs input, command failed (error), approval needed.
- **Command palette:** `⌘K` opens the overlay; typing filters; `↑/↓` move selection; `⏎` runs; `esc` closes.
- **Animations:** `pulse` (status dots, 1.6s ease-in-out, opacity 1→.35 + scale 1→.82), `blink`
  (cursors, 1.1s step-end), `spin` (spinner, 1.1s linear).

## State Management

Suggested state the implementation needs:

- `sessions[]` — each `{ id, name, status, panes[], agents[] }`.
- `agents[]` per session — `{ id, kind: 'ai'|'human', name, task, status: 'running'|'waiting'|'idle', parentId? }` (parentId enables the sub-agent tree).
- `activeSessionId`, `focusedPaneId`.
- `pendingApprovals[]` — `{ id, sessionId, agentId, command, risk }` drives inline pane state, tree node, bell badge, and toast.
- `notifications[]` — `{ id, type: 'done'|'input'|'error'|'approval', title, detail, ts }`.
- `changedFiles[]` — `{ path, name, author: 'ai'|'human', add, del, status: 'M'|'A'|'D', diff[] }` for the diff panel; `selectedFilePath`.
- `theme` — one of the four palettes; `showDiffPanel`, `showPalette` UI toggles.
- Terminal I/O: bind each pane to an xterm.js instance + PTY; agents are processes whose stdout is parsed for step/diff/approval events.

## Design Tokens

Applied as CSS custom properties on the root; default is **Minimal Dark**. Themes swap the same token
set (recreate as a theme map).

**Minimal Dark (default):**

- `--bg #0b0b0d` · `--panel #0f0f12` · `--elev #17171b`
- `--border rgba(255,255,255,0.07)` · `--border2 rgba(255,255,255,0.12)`
- `--text #e8e8ea` · `--dim #9a9aa2` · `--faint #5c5c64`
- `--accent #4ec97a` (running/brand) · `--amber #e0a94a` (waiting/approval) · `--red #f0625f` (error/removed) · `--blue #6aa0f0` (human/info)

**Tokyo Night:** bg `#1a1b26` panel `#16161e` elev `#20212f` text `#c0caf5` dim `#7982a9` faint `#565f89` accent `#9ece6a` amber `#e0af68` red `#f7768e` blue `#7aa2f7`
**Catppuccin (Mocha):** bg `#1e1e2e` panel `#181825` elev `#313244` text `#cdd6f4` dim `#a6adc8` faint `#6c7086` accent `#a6e3a1` amber `#f9e2af` red `#f38ba8` blue `#89b4fa`
**Gruvbox:** bg `#1d2021` panel `#282828` elev `#32302f` text `#ebdbb2` dim `#a89984` faint `#7c6f64` accent `#b8bb26` amber `#fabd2f` red `#fb4934` blue `#83a598`

**Spacing:** panel paddings `12–16px`; row paddings `6px 12px`; gaps `4 / 8 / 9 / 14 / 16px`.
**Radii:** `4px` (chips/keycaps) · `6–7px` (tabs/buttons/pills) · `11px` (toasts) · `13px` (palette).
**Shadows:** toast `0 18px 40px -12px rgba(0,0,0,.6)`; info `0 14px 34px -14px rgba(0,0,0,.55)`; palette `0 30px 70px -20px rgba(0,0,0,.75)`.

**Typography:**

- **JetBrains Mono** (400/500/600/700) — terminal panes, diff, code/command blocks. Sizes `12–12.5px`, line-height `1.75` (terminal) / `1.85` (diff).
- **Geist Mono** (400/500/600) — all app chrome (tabs, sidebar, status bar, buttons, palette). Base `12px`; labels `10–13px`; brand `13px`.
- Uppercase section labels: `10px`, `letter-spacing 0.14em`, weight 600.

## Assets

- **Fonts:** JetBrains Mono + Geist Mono — both free (OFL), on Google Fonts. Bundle locally in production.
- **Icons:** [Phosphor Icons](https://phosphoricons.com) (regular / bold / fill weights). Icons used:
  `terminal-window`, `magnifying-glass`, `gear-six`, `plus`, `minus`, `square`, `x`, `tree-structure`,
  `robot`, `user`, `flow-arrow`, `caret-down`, `caret-right`, `arrows-out-simple`, `hard-drives`,
  `git-branch`, `bell`, `file-ts`, `file-plus`, `shield-warning`, `check`, `check-circle`,
  `squares-four`, `columns`, `palette`, `swap`. Use the `@phosphor-icons/react` package in a React app.
- No raster images; the diff/terminal text is illustrative sample data.

## Files

- `Mux.dc.html` — the high-fidelity design reference (open in a browser to view). Contains the full
  layout, all four themes, and the approval/palette overlay states.
