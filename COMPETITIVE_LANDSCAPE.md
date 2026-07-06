# Competitive Landscape — smterm

> Who else is building "run and watch a fleet of coding agents," how they differ, and where
> smterm's wedge is. Companion to `ARCHITECTURE.md` (design) and `ROADMAP.md` (progress).

Status: **living doc** — the space moves fast (tools rename, companies fold). Snapshot as of
**2026-07-06**; re-verify names/status before citing (see §6 for known traps).

---

## 1. The convergence thesis

Independently, from different starting points, a whole category converged on the same idea in
2025–2026: **a surface for running multiple coding agents in parallel and watching their status.**

- IDEs pivoted toward it — **Cursor 2/3** made an "agent-first" view the default; **VS Code**
  shipped a built-in **Agent Sessions** sidebar (model-agnostic: Claude, Codex, Copilot).
- A crop of standalone tools appeared — terminals, desktop apps, and kanban boards — all solving
  the same two problems:
  1. **Isolation** so parallel agents don't clobber each other's files → almost universally
     **git worktrees** (a few use containers).
  2. **A unified view** of every session's status (running / waiting / done).

So "a dashboard over agents" is now **table stakes, not a differentiator.** The differentiation is
in _form factor_, _cross-platform reach_, _agent-agnosticism_, and _execution quality_ (§4–§5).

---

## 2. The map: two axes

Every tool sits on two axes. This is the useful mental model.

```
                     SURFACE
   terminal-native ◄──────────────────► GUI board / IDE
        │                                     │
        │  cmux, ccmanager,        Conductor, Nimbalyst,
        │  Claude Squad, dmux,     Vibe Kanban, Cursor,
        │  Superset, Paneflow,     VS Code Agent Sessions
        │  amux                    Sculptor
        │
   ─────┼───────────────────────────────────────────  ISOLATION
        │  worktrees (almost everyone)  │  containers (Sculptor)
```

- **Surface** — is the primary object a _terminal/PTY_, or a _board / diff-review GUI_?
- **Isolation** — **git worktree per agent** is the default substrate; **containers** are the
  heavier-isolation outlier.

Crowded corners: **macOS-native terminal** (cmux, Conductor, Paneflow) and **web/kanban boards**
(Vibe Kanban, Nimbalyst). Thin corner → smterm's opening (§5).

---

## 3. The field, by form factor

### 3a. Terminal-native / TUI managers (smterm's direct neighbors)

| Tool             | Shape                                                             | Platforms             | Notes                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cmux**         | Native app, Ghostty (`libghostty`) engine                         | macOS only            | The famous one. GPU render, vertical tabs, notifications, in-app browser. By **Manaflow** (YC S24). ~17k GitHub stars in ~2 weeks. AGPL                               |
| **ccmanager**    | TUI session manager                                               | Cross-platform        | **Broadest agent support**: Claude Code, Codex, Gemini CLI, Cursor Agent, Copilot CLI, Cline, OpenCode…; git worktree support. smterm's closest competitor on breadth |
| **Claude Squad** | tmux-based harness                                                | Cross-platform (tmux) | Run/manage multiple Claude Code sessions side-by-side                                                                                                                 |
| **dmux**         | Node CLI over tmux                                                | Cross-platform (tmux) | Each tmux pane = its own worktree + branch                                                                                                                            |
| **amux**         | Single Python file → local HTTPS server + web dashboard over tmux | Cross-platform (tmux) | Self-healing watchdog auto-restarts crashed agents; auto-compacts context overflow                                                                                    |
| **Superset**     | Terminal built for agents                                         | —                     | Orchestrates parallel sessions                                                                                                                                        |
| **Paneflow**     | Native, Rust on Zed's **GPUI**                                    | Linux / Windows       | The native-not-webview take for non-mac                                                                                                                               |
| **wmux**         | Electron + xterm.js                                               | Windows               | Windows port of cmux                                                                                                                                                  |

### 3b. Desktop GUI apps (worktree isolation + diff/PR review)

| Tool          | Platforms | Notes                                                                                                              |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| **Conductor** | macOS     | Worktree per workspace, strong diff viewer + PR flow, fully local. Claude Code + Codex                             |
| **Nimbalyst** | Desktop   | Visual workspace + kanban; **renamed from Crystal**; broad (mockups, diagrams, multi-editor, heterogeneous agents) |
| **Sculptor**  | Desktop   | The outlier — isolates with **containers, not worktrees** (stronger isolation, heavier)                            |

### 3c. Board / Kanban orchestration (cross-platform, web UI)

| Tool            | Notes                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vibe Kanban** | CLI + web kanban board; worktree-isolated tasks; visual code review. ⚠️ Company (**Bloop**) shut down **2026-04-10**; now Apache-2.0, community-maintained; paid cloud sunset |
| **Nimbalyst**   | Also board-shaped (see 3b)                                                                                                                                                    |

### 3d. Built into editors

| Tool                       | Notes                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cursor 2/3**             | "Agent-first" default view; up to ~8 parallel agents in isolated envs; Classic Editor is a toggle. Backlash over agent UI crowding out the code + non-remappable shortcuts (§4)                                                            |
| **VS Code Agent Sessions** | Built-in sidebar over local/background/cloud sessions; model-agnostic (Claude, Codex, Copilot as of 1.109). **Only tracks agents launched through / registered with VS Code** — a bare `claude` in a plain terminal is _not_ auto-detected |

### 3e. Directories worth tracking (the field moves weekly)

- [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents)

---

## 4. Lessons from competitors' criticism (design constraints for us)

The _idea_ is validated everywhere; execution keeps failing on the **same two things**. These are
free lessons — bake them into smterm's design (see `ARCHITECTURE.md` §8, §9).

1. **Respect the primary surface.** Cursor's loudest complaint: the agent/chat chrome _"take[s]
   space more than the actual code."_ → For us the **terminal (PTY) must stay the star**; status is
   ambient badges, not a giant panel that eats the shell.
2. **Respect the keyboard — and let users remap.** Both **cmux** (keyboard shortcuts break after
   opening/closing browser tabs) and **Cursor** (layout shortcuts conflict with custom bindings,
   _not reconfigurable_) drew blood here. → **User-configurable keybindings from v1**; never hijack
   a combo the user can't rebind.
3. **Native ≠ automatically fast or bug-free.** cmux went native explicitly citing perf/input, yet
   ships **laggy scrolling, higher CPU than plain Ghostty**, and input bugs. → Stack choice isn't
   the quality lever; **execution is.** Reassures the Tauri decision (`ARCHITECTURE.md` §3).
4. **Make the escape hatch discoverable.** Cursor's "Classic Editor" existed but users had to be
   _told_ by a moderator. → Any mode/layout switch must be obvious.
5. **Persistence & remote are real gaps users hit.** cmux is **macOS-only with no detach/reattach**
   → "doesn't work on remote terminals." → Our answer is deliberate (`ARCHITECTURE.md` Appendix A):
   local daemon later; **wrap the remote's `tmux`/`mosh`** rather than shipping a remote daemon.

---

## 5. smterm's positioning (the wedge)

Against the map in §2, the thin/open corner is:

> **Genuinely cross-platform (macOS · Linux · Windows · WSL) · terminal-native with real PTYs ·
> lightweight · agent-agnostic.**

How we compare to the two poles we're threading between:

| Dimension                 | cmux                          | ccmanager               | **smterm (target)**                    |
| ------------------------- | ----------------------------- | ----------------------- | -------------------------------------- |
| Surface                   | Native GPU terminal           | TUI (inside a terminal) | GUI terminal (Tauri + xterm.js)        |
| Platforms                 | macOS only                    | Cross-platform          | **mac · Linux · Windows · WSL**        |
| Agent-agnostic            | Yes (runs any CLI)            | **Yes, broadest**       | Yes (any PTY program)                  |
| Footprint                 | Native, but heavy in practice | Tiny (TUI)              | **Small (Tauri, not Electron)**        |
| Native polish             | **Highest**                   | n/a (TUI)               | Mid (webview)                          |
| Notifications / attention | Yes                           | Limited                 | **Headline feature** (OSC 9 / OSC 133) |
| Split panes + tabs GUI    | Yes                           | Limited (TUI)           | **Yes, v1**                            |
| Persistence / reattach    | ❌                            | Via tmux                | Planned (Appendix A)                   |

**Honest read of the competition:**

- **cmux** beats us on native polish but is **macOS-only** — its cross-platform ports are separate
  projects (wmux/Electron, Paneflow/GPUI). One codebase across four targets is our structural edge.
- **ccmanager** is the closest on _agent breadth + cross-platform_, but it's a **TUI** — no native
  GUI tabs/panes, weaker notifications, no OS-native toasts. Our GUI + native notifications is the
  differentiator there.
- **Board tools** (Vibe Kanban, Nimbalyst, Conductor) optimize for _review/PR/kanban_. We optimize
  for **watching live terminals** — a different job. Not a direct fight; a different surface.

**What is NOT a differentiator (don't sell these):** "a view over agents," "worktree isolation,"
"parallel agents." Everyone has them. Our story is **reach + terminal-native + weight + attention
signals**, not the fleet concept itself.

---

## 6. Naming & status traps (verify before citing)

- **Crystal → Nimbalyst** — renamed; the old repo now says "Crystal is now Nimbalyst."
- **Vibe Kanban** — company **Bloop shut down 2026-04-10**; project continues as Apache-2.0
  community-maintained; paid cloud/remote sunset. Alive as OSS, dead as a company.
- **Sculptor / Mux** — often listed as "orchestrators" but are better read as _adjacent multi-agent
  environments_, not direct Claude-Code+Codex session managers.
- The category is churny — assume any tool here may have renamed, changed license, or folded since
  this snapshot. The two directories in §3e are the freshest trackers.

---

## Sources

- [Best AI Agent Multiplexers Compared (2026): 12 Tools Ranked — amux.io](https://amux.io/guides/best-ai-agent-multiplexers-2026/)
- [Best Tools for Managing Parallel AI Coding Agents in 2026 — Nimbalyst](https://nimbalyst.com/blog/best-agent-management-tools-2026/)
- [9 Open-Source Agent Orchestrators for AI Coding (2026) — Augment Code](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- [cmux Alternatives (2026) — vibecoding.app](https://vibecoding.app/alternative/cmux-alternative)
- [cmux — GitHub (manaflow-ai/cmux)](https://github.com/manaflow-ai/cmux)
- [cmux vs tmux — Soloterm](https://soloterm.com/cmux-vs-tmux)
- [New Coding Model and Agent Interface — Cursor 2.0 changelog](https://cursor.com/changelog/2-0)
- [Your Home for Multi-Agent Development — VS Code blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [awesome-agent-orchestrators — GitHub](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [awesome-cli-coding-agents — GitHub](https://github.com/bradAGI/awesome-cli-coding-agents)
