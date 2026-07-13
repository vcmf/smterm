# mux — Product Specification

> A cross-platform terminal that treats AI agents as first-class citizens.
> Multiplexer + agent orchestration + live file awareness, on Windows/WSL, Linux, and macOS.

**Status:** Draft v0.1 · **Owner:** — · **Last updated:** 2026-07-07

---

## 1. Summary

`mux` is a terminal application for the era where humans and AI coding agents work side by side.
It combines three things that today live in separate tools:

1. A real **terminal multiplexer** (like tmux/Zellij) — many sessions, split panes, persistence.
2. An **agent orchestrator** — spawn, watch, approve, and interrupt AI agents running in those panes.
3. **Live file awareness** — for every pane, see exactly which files are changing (by AI or human)
   as a git-style diff, in real time.

Unlike cmux, it is **cross-platform first** (Windows/WSL, Linux, macOS share one experience) and it
**does not embed a browser** — it stays a lean, fast, keyboard-driven terminal with a sleek monospace UI.

**One-line pitch:** _tmux for the agent age — see every agent, every file, every decision in one sleek window._

---

## 2. Problem

Developers now run AI agents that edit code, run commands, and spawn sub-tasks — but the tooling is
fragmented and opaque:

- **You can't see what's happening across agents.** Multiple agents in multiple tabs/terminals =
  constant context-switching. No single view of "who is doing what, and who's stuck."
- **You can't see what agents are changing** until you `git diff` after the fact. There's no live,
  per-pane view of the files being touched — by the AI _or_ by you.
- **Approvals are all-or-nothing or invisible.** Either you `--dangerously-skip-permissions` and pray,
  or you babysit each prompt. There's no calm, centralized approval surface.
- **Cross-platform is painful.** WSL vs native Windows vs macOS terminals behave differently; agent
  tooling is usually macOS/Linux-only.
- **Existing terminals are either beautiful-but-dumb (Warp, Ghostty) or powerful-but-ugly (tmux).**
  None are built around agents.

---

## 3. Goals / Non-Goals

### Goals

- G1 — One window to run and **supervise many agents across many sessions**.
- G2 — **Live, per-pane file-change view** (git-style diff) showing AI vs human authorship.
- G3 — A calm, centralized **notification + approval** system (finished / needs input / failed / wants-to-run).
- G4 — **True cross-platform** parity: Windows/WSL, Linux, macOS feel identical.
- G5 — **Sleek, fast, keyboard-first** UX with beautiful monospace type and a customizable theme.

### Non-Goals (v1)

- ❌ Embedded web browser (cmux has one; we deliberately don't).
- ❌ Being an IDE / code editor. We _show_ diffs; we don't replace VS Code.
- ❌ Hosting/running the models ourselves. We orchestrate whatever agent CLI the user has (Claude Code, etc.).
- ❌ Team/cloud collaboration in v1 (see Future).

---

## 4. Target Users & Personas

- **The agent wrangler** — runs 3–6 agents at once on a big refactor; needs a control tower.
- **The cautious engineer** — wants agents' power but must approve anything destructive; needs trust surfaces.
- **The WSL developer** — lives on Windows + WSL and is tired of second-class agent tooling.
- **The terminal purist** — loves tmux/Ghostty, wants agent features without giving up speed or keyboard control.

---

## 5. Macro Product Ideas

These are the "big bets" that define the product's character.

### M1 — Agents are objects, not just text streams

An agent isn't just scrollback in a pane — it's a **first-class entity** with identity, status, a task,
a parent (if spawned as a sub-agent), the files it owns, a cost/runtime meter, and a permission scope.
The whole UI (tree, notifications, diff authorship) is built on this object model. This is the core
differentiator vs. "a terminal that happens to run an agent."

### M2 — The Agent Tree as the control tower

A live tree of **sessions → agents → sub-agents** is the app's spine. At a glance you see who's
**running / waiting / idle / failed**, who needs you, and how work fans out. Think "Activity Monitor
for agents." It's how you supervise 6 agents without 6 tabs of anxiety.

### M3 — Files-in-flight

Every pane has a **live diff sidecar**: as an agent (or you) edits, the changed files stream in with
+/- counts and **authorship badges** (🤖 vs 👤). You never wonder "what did it just change?" This turns
the terminal into a real-time code-review surface without leaving it.

### M4 — Trust dial, not a kill switch

A single **approval surface** with graduated policies per agent/session (auto-run safe commands,
always-ask for destructive ones, hard-block a denylist). Approvals collect in one place — inline in
the pane, as a tree badge, and as a toast — so you're never hunting for a hidden prompt.

### M5 — One brain, three OSes

A shared core (Rust/Tauri or Electron) with platform adapters so **WSL, Linux, and macOS are identical**.
Sessions can target a specific runtime (`Open on: Ubuntu-22.04 (WSL)`), and the status bar always tells
you where a pane actually lives.

### M6 — Sleek by default, yours to theme

Default **minimal-dark**, beautiful monospace (JetBrains Mono for content, Geist Mono for chrome),
Phosphor icons — plus first-class theming (Tokyo Night, Catppuccin, Gruvbox, custom). The terminal you
_want_ to leave open all day.

### M7 — Session persistence & restore

Like tmux: **sessions survive** disconnects, crashes, and restarts. Reopen `mux` and your panes,
scrollback, and agent context are back. Detach/attach across machines later (Future).

---

## 6. Feature Set

### 6.1 Multiplexer core

- **Sessions & tabs** — multiple named sessions; tabs across the top; per-session running indicator.
- **Split panes** — arbitrary horizontal/vertical splits, grid layouts, resize, maximize/zoom a pane,
  swap/move panes.
- **Layouts** — save/restore named layouts (e.g. "review": editor-agent left, shell right, diff panel open).
- **Persistence** — sessions, scrollback, and layout survive restart; auto-reconnect PTYs.
- **Fast terminal** — GPU-accelerated rendering (xterm.js/WebGL or wgpu), true-color, ligatures,
  proper Unicode/CJK, hyperlinks (OSC 8), image protocols (later).
- **Keyboard-first** — every action has a binding; leader-key chords; fully rebindable; tmux-compat mode.

### 6.2 Agent orchestration

- **Spawn agents** in any pane (bring-your-own CLI: Claude Code or other agent runners).
- **Agent Tree** — sessions → agents → sub-agents with live status (running/waiting/idle/failed/done),
  current task, files touched, elapsed time, and (if available) token/cost meter.
- **Sub-agent spawning** — an agent can fork sub-tasks; the tree shows the parent/child relationship.
- **Controls per agent** — pause, resume, interrupt (Ctrl-C), send input, restart, kill.
- **Focus & follow** — click an agent to focus its pane; "follow" mode auto-scrolls to the active agent.
- **Bulk ops** — pause all, approve-all-safe, "show me only agents waiting on me."

### 6.3 Live file awareness (Files-in-flight)

- **Per-pane diff panel** — files changed since a baseline (branch point / session start), with +/- counts.
- **Authorship** — each file tagged 🤖 AI (which agent) or 👤 human, with timestamps ("edited 20s ago").
- **Inline diff viewer** — git-style red/green hunks, syntax-highlighted, expandable context.
- **Change timeline** (option) — a chronological feed of edits as they happen.
- **Conflict awareness** — flag when AI and human edit the same file/region; offer a resolve view.
- **One-click actions** — stage, discard, open in `$EDITOR`, copy path, revert an agent's edit.
- **Git integration** — current branch, ahead/behind, dirty state in the status bar; stage/commit from the panel.

### 6.4 Notifications & approvals

- **Triggers** — agent finished · agent needs input · command failed/error · approval requested ·
  file conflict detected · long-running command done.
- **Surfaces** — inline in the pane, a badge on the tree node, a status-bar bell count, and a toast.
  Optional OS-native notifications (Windows toast / macOS Notification Center / libnotify) when unfocused.
- **Approval policies (the trust dial)** — per agent/session:
  - _Auto_ — run safe/allow-listed commands without asking.
  - _Ask_ — prompt for anything not on the allowlist (default).
  - _Deny-list_ — hard-block patterns (`rm -rf`, `git push --force`, `DROP TABLE`, secrets exfil).
  - Remember decisions ("always allow `pnpm test`").
- **Approval card** — shows the exact command, the risk, which agent/session, and Approve/Deny with
  keyboard shortcuts (`a`/`d`). A central **Approvals inbox** lists everything pending.

### 6.5 Command palette & navigation

- **⌘K / Ctrl-K palette** — spawn agent, switch session, split pane, change theme, open on a specific
  runtime, jump to a waiting agent, run saved commands.
- **Fuzzy everything** — sessions, agents, files, commands, and command history.
- **Quick switch** — `Ctrl-1..9` for sessions/panes; `gt`/`gT` tab nav.

### 6.6 Cross-platform runtime

- **Runtimes** — native Windows (ConPTY), WSL distros, Linux, macOS; each session targets one.
- **Runtime picker** — "Open on: Ubuntu-22.04 (WSL)"; status bar shows the active runtime per pane.
- **Path & env translation** — sane handling of Windows↔WSL paths, shells (pwsh/bash/zsh/fish), env vars.
- **Single install experience** — signed installers for all three OSes; auto-update.

### 6.7 Appearance & UX

- **Themes** — Minimal Dark (default) + Tokyo Night, Catppuccin, Gruvbox, and custom themes;
  light + dark variants.
- **Typography** — JetBrains Mono (terminal/diff) + Geist Mono (chrome); user-swappable font & size.
- **Icons** — Phosphor throughout.
- **Density** — comfortable/compact; adjustable pane chrome.
- **Accessibility** — high-contrast themes, scalable UI, full keyboard operability, screen-reader labels.

---

## 7. Information Architecture

```
Window
├── Top bar        · brand · session tabs (+running dots) · ⌘K · settings · window controls
├── Sidebar        · Agent Tree (sessions → agents → sub-agents) + status legend
├── Terminal grid  · split panes (per-pane header: role, badge, controls)
├── Diff panel     · changed files (authorship) + inline red/green diff
├── Status bar     · runtime (WSL/Linux/macOS) · git branch/ahead-behind · running/waiting counts · bell · clock
└── Overlays       · approval + notification toasts · ⌘K command palette
```

---

## 8. Key Flows

**F1 — Spawn & supervise:** `⌘K → New agent` → agent appears in a pane + tree node (running) → user
watches steps stream and files land in the diff panel.

**F2 — Approval:** agent proposes `prisma migrate dev` → pane shows it inline, tree node turns amber
(waiting), bell increments, toast appears → user reviews command + risk → `a` approves / `d` denies.

**F3 — Review changes:** user clicks a changed file in the diff panel → inline red/green hunks →
verifies AI's edit → stages or reverts.

**F4 — Conflict:** AI and human both edited `verify.ts` → conflict flag on the file → user opens
resolve view → picks/merges.

**F5 — Switch runtime:** `⌘K → Open on: Ubuntu-22.04 (WSL)` → new session bound to that runtime →
status bar reflects it.

---

## 9. Success Metrics

- **Supervision load:** median agents watched per user > 3 without extra windows.
- **Trust:** % of destructive commands that pass through the approval surface (target ~100%); zero
  "silent" dangerous runs.
- **Time-to-awareness:** seconds from an agent's edit to the user seeing it in the diff panel (target < 1s).
- **Cross-platform parity:** feature checklist passing identically on all 3 OSes.
- **Stickiness:** daily sessions kept open; retention of persisted sessions after restart.

---

## 10. Technical Notes (non-binding)

- **Shell:** Tauri (Rust core) preferred for size/perf & native PTYs, or Electron for ecosystem speed.
- **Terminal:** xterm.js + WebGL renderer (or a wgpu-based grid) for GPU-accelerated output.
- **PTY:** `node-pty` (Electron) / `portable-pty` (Rust); ConPTY on Windows, WSL bridging for distros.
- **Agent model:** adapter layer that wraps agent CLIs; parse structured events (step/edit/approval)
  from their output or a protocol; fall back to heuristics for plain CLIs.
- **Diff engine:** watch the working tree (fs events) + git plumbing for baselines; attribute edits to
  the process that made them (agent PID ↔ file writes) for authorship.
- **State:** local persistent store for sessions/layouts/policies; everything works offline.

---

## 11. Risks & Open Questions

- **Agent event fidelity** — how reliably can we detect "wants to run X" / "finished" across different
  agent CLIs? (May need per-tool adapters or a small protocol.)
- **Authorship attribution** — mapping filesystem writes to a specific agent vs the human is non-trivial;
  fallback UX if uncertain.
- **Windows/WSL edge cases** — path translation, signal handling, performance.
- **Scope creep toward an IDE** — hold the line: show diffs, don't become an editor.
- **Approval fatigue** — policies must be smart enough that users don't just switch to "auto everything."

---

## 12. Roadmap

**v0 — Foundation:** multiplexer (sessions, splits, persistence), fast terminal, themes, ⌘K.
**v1 — Agents:** agent tree, spawn/controls, notifications + approval surface, per-pane diff panel with
authorship, cross-platform runtimes (Win/WSL/Linux/macOS).
**v1.x — Trust & review:** approval policies/allowlists, conflict detection + resolve view, git
stage/commit from the panel, change timeline.
**Future:** detach/attach across machines, team/shared sessions & shared agents, remote/SSH runtimes,
agent cost dashboards, plugin API, mobile companion for approvals on the go.

---

## 13. Design Reference

The look & feel is specified in the hi-fi mock `Mux.dc.html` (see also `design_handoff_mux_terminal/`
for the full implementation spec, tokens, and component states).
