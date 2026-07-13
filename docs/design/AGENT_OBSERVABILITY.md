# Design — Agent observability: the live agents & worktrees board

> Surface every running agent smterm launched — the agent, its sub-agents, its worktree, its
> recent file activity, its status — as a first-class **board** in the app, fed by Claude Code's
> **official** extension points (hooks now; OpenTelemetry traces later). Companion to
> `../ARCHITECTURE.md`; supersedes the "control-plane road" caveat in `AGENT_TEAMS.md` §11 for the
> specific case of _official_ telemetry.

Status: **DESIGN / accepted for Phase 1** (2026-07-13). Milestone: see `../ROADMAP.md` → M6.

---

## 1. Goal & the reframe

**Goal.** A panel that answers, at a glance: _which agents are running right now, what is each one
doing, in which worktree, and who spawned whom._ Plus the file/worktree view that falls out of the
same data.

**The reframe that makes this tractable.** A terminal sees only **OS processes + byte streams**, so
the PTY can't observe an agent's _in-process_ sub-agents (the `Task` tool). Earlier design
(`AGENT_TEAMS.md`) treated the sub-agent tree as effectively unreachable without scraping private
state. That was wrong in one important way: **Claude Code emits its own structure through documented,
supported channels** — hooks and OpenTelemetry. Ingesting those is an _integration_, not scraping. So
the agent tree is reachable — just not from the PTY.

**Non-negotiable principle (unchanged).** smterm stays terminal-first. This is an **additive,
opt-in observability layer**, wired only for the shells smterm itself launches; it never becomes a
prerequisite for using the terminal, and it never parses undocumented private files.

---

## 2. Data sources (researched 2026-07-13)

Two official channels, complementary:

### 2a. Hooks → localhost (Phase 1 foundation — stable, real-time)

Claude Code exposes [31 hook events](https://code.claude.com/docs/en/hooks). The ones we consume:

| Event                               | Gives us                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SubagentStart` / `SubagentStop`    | a sub-agent's `agent_id`, `agent_type`, `agent_transcript_path`, `session_id` — spawn + teardown |
| `TaskCreated` / `TaskCompleted`     | task lifecycle within a session                                                                  |
| `SessionStart` / `SessionEnd`       | the root agent lifecycle                                                                         |
| `WorktreeCreate` / `WorktreeRemove` | **the worktree view, for free**                                                                  |
| `CwdChanged`                        | keeps each agent's cwd live (complements our OSC-7 tracking)                                     |
| `FileChanged`                       | recent file activity per agent → the "file view"                                                 |
| `Notification` / `Stop`             | attention / turn-boundary signals (dovetails with our status engine)                             |

Hooks can be typed **`http`** and POST the event JSON to `http://localhost:<port>`. So smterm runs a
tiny loopback receiver and gets every event **as it happens** (no batching). Common fields on every
event: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`.

**Known gap:** hook input does **not** include an explicit `parent_agent_id`. Lineage within a
session is _inferred_ (shared `session_id` + start/stop ordering + `agent_id` presence). Good enough
for a flat "root → sub-agents" grouping; exact multi-level parenting comes from OTEL (2b).

### 2b. OpenTelemetry traces → local OTLP receiver (Phase 2 — richer, beta)

With [`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_TRACES_EXPORTER=otlp`,
`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`](https://code.claude.com/docs/en/agent-sdk/observability)
pointed at a **local** OTLP HTTP endpoint, Claude emits spans:

- `claude_code.interaction` (a turn) → `claude_code.llm_request`, `claude_code.tool`
  (`.execution` / `.blocked_on_user`), `claude_code.hook`.
- **The tree:** _"when the agent spawns a subagent through the Task tool, the subagent's
  `llm_request` and `tool` spans nest under the parent agent's `claude_code.tool` span, so the full
  delegation chain appears as one trace."_ Recent versions also stamp explicit `agent_id` /
  `parent_agent_id` attributes; spans carry `session.id`.
- Bonus: token/cost/latency per span.

**Caveats:** traces are **beta** ("span names and attributes may change between releases"); export is
batched (default 5 s, tunable to 1 s via `OTEL_TRACES_EXPORT_INTERVAL=1000`); needs a recent Claude
Code. **Open question to spike:** confirm the _interactive_ `claude` TUI (not just the SDK / `claude -p`)
emits these trace spans — the observability docs are framed around the SDK. Hooks almost certainly
fire interactively; traces need empirical confirmation before we depend on them.

---

## 3. The zero-setup lever

smterm already injects env + shell integration into the shells it spawns
(`electron/shell-integration.ts`, `pty:spawn`). We extend that injection to:

1. Register our hook config **scoped to launched panes** (via a temp settings dir / `CLAUDE_*`
   config pointer we control) so we never mutate the user's global `~/.claude/settings.json`.
2. Set the telemetry env (Phase 2) pointing at our loopback receiver.

Result: the board **just works** for agents started inside smterm, with **no user setup** and no
global config footprint. Agents started outside smterm simply don't appear (acceptable; opt-in).

---

## 4. Architecture

```
  claude (in a smterm pane)
     │  hook fires (SubagentStart, FileChanged, WorktreeCreate, …)
     ▼
  HTTP POST → 127.0.0.1:<port>  (smterm main: hook receiver, electron/agent-hooks.ts)
     │  validate + normalise → AgentEvent
     ▼
  agent-graph reducer (pure, tested — lib/agent-graph.ts)   ← the risky logic lives here
     │  events → { agents: tree keyed by session/agent_id, worktrees, recent files, status }
     ▼  IPC event agents:update → renderer store slice
  Agents board (React) — tree of agents, per-agent worktree + diff + files + status
```

| Component               | Where                                             | Job                                                                            |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hook receiver           | `electron/agent-hooks.ts` (main)                  | loopback HTTP server; auth via a per-launch token; parse events                |
| Hook config injector    | `electron/shell-integration.ts` + `pty:spawn`     | scope the hook config to launched panes; pass the port + token                 |
| **Agent-graph reducer** | `src/lib/agent-graph.ts` (**pure, unit-tested**)  | fold the event stream into the agent tree + worktree/file state; infer lineage |
| Renderer bridge         | `lib/ipc.ts` + a store slice                      | `agents:update` → Zustand; drives the board                                    |
| Agents board            | `src/components/agents-panel.tsx`                 | render the tree; reuse status-ui + git diff panel + session-label              |
| Reuse (unchanged)       | git.ts, session-status, use-active-cwd, status-ui | worktree diffs, status dots, cwd — all already exist                           |

Design rule (matches repo conventions): **the parsing/folding is a pure reducer** in
`lib/agent-graph.ts` with a real test matrix; the HTTP plumbing and React are thin.

---

## 5. Phasing

- **Phase 1 — Hooks board (this milestone).** Loopback hook receiver + injection + `agent-graph`
  reducer + the board. Delivers: live agents/sub-agents grouped per session with type & status,
  each agent's worktree + live git diff, recent files, and worktree create/remove — i.e. **both the
  agents view and the file/worktree view**. Stable, real-time, zero user setup.
- **Phase 2 — OTEL trace overlay (later, opt-in, flagged beta).** Local OTLP receiver adds exact
  multi-level parent→child lineage + token/cost/latency. Gated behind a setting; degrades to Phase 1
  if telemetry is off or the interactive-CLI spike fails.
- **Phase 3 — cross-agent generalisation (future).** The reducer is agent-agnostic; other agents
  that emit OTEL or a documented hook contract can populate the same board.

---

## 6. Risks & open questions

- **Interactive-CLI emission (spike first).** Confirm hooks fire and (for Phase 2) traces emit from
  the interactive TUI, not only the SDK. Blocks nothing in Phase 1 if hooks fire (expected).
- **Lineage from hooks is inferred**, not exact — fine for grouping; exact tree is Phase 2.
- **Beta trace schema churn** — keep OTEL parsing isolated and version-guarded; never let it break
  Phase 1.
- **Claude-specific** — acceptable for v1; the reducer stays agent-agnostic for Phase 3.
- **Security** — loopback only, per-launch token, no content logging by default (don't set
  `OTEL_LOG_*` / tool-content hooks). The board shows structure, not prompt/file contents.
- **Version floor** — needs a recent Claude Code; detect and degrade gracefully (no hooks → empty
  board, not an error).

---

## 7. Out of scope

- Reading undocumented private state files (the control-plane road we still reject).
- Driving/orchestrating agents from smterm (this is _observe_, not _control_).
- Non-Claude agents in v1 (the mechanism generalises later — §5 Phase 3).
