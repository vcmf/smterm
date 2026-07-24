// File-drop watcher for Claude Code hooks (M6). Claude writes each event as a file into
// a watched directory (see electron/hook-writer.ts); we read + delete each file, normalise
// it off any hot path, and forward coalesced batches to the renderer (which holds the
// AgentGraph and runs the pure reducer). No HTTP server, no port — so nothing can go stale
// (the old loopback receiver's ECONNREFUSED class) and it works across the WSL boundary,
// where a Windows-loopback server is unreachable. See docs/design/AGENT_OBSERVABILITY.md.

import fs from "node:fs"
import path from "node:path"
import { watch } from "chokidar"
import type { AgentEvent } from "../src/lib/agent-graph"

// tool_input keys that carry a file path, across the file-touching tools.
const FILE_TOOL_KEYS = ["file_path", "path", "notebook_path"] as const

/** Raw hook JSON (+ the pane id parsed from the drop file's name) → the normalised
 *  AgentEvent; null if the payload lacks the minimum (event name + session id). */
export function normalizeHookEvent(raw: unknown, paneId?: string): AgentEvent | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.hook_event_name !== "string" || typeof r.session_id !== "string") return null
  const ti = (typeof r.tool_input === "object" && r.tool_input ? r.tool_input : {}) as Record<
    string,
    unknown
  >
  const filePath = FILE_TOOL_KEYS.map((k) => ti[k]).find((v) => typeof v === "string") as
    string | undefined
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  return {
    event: r.hook_event_name,
    sessionId: r.session_id,
    paneId: paneId || undefined,
    agentId: str(r.agent_id),
    agentType: str(r.agent_type),
    cwd: str(r.cwd),
    toolName: str(r.tool_name),
    filePath,
    message: str(r.message) ?? str(r.last_assistant_message),
    worktreePath: str(r.worktree_path),
    baseBranch: str(r.base_branch),
  }
}

export interface HookWatcher {
  close: () => Promise<void>
}

export interface HookWatcherOptions {
  dir: string // the drop directory to watch (must already exist)
  onBatch: (events: AgentEvent[]) => void // coalesced, off any hot path
  coalesceMs?: number // batch window (default 50ms) — one emit per window
}

/** Watch `dir` for event files; parse + delete each, tag it with the pane id encoded in
 *  the filename, and forward coalesced batches. Best-effort — a bad/partial file is skipped. */
export async function startHookWatcher(opts: HookWatcherOptions): Promise<HookWatcher> {
  const coalesceMs = opts.coalesceMs ?? 50
  let pending: AgentEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pending.length === 0) return
    const batch = pending
    pending = []
    try {
      opts.onBatch(batch)
    } catch {
      // a consumer error must never take down the watcher
    }
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, coalesceMs)
  }

  const ingest = (file: string) => {
    void fs.promises
      .readFile(file, "utf8")
      .then((body) => {
        void fs.promises.rm(file, { force: true }).catch(() => {})
        let raw: unknown
        try {
          raw = JSON.parse(body)
        } catch {
          return // partial/corrupt drop — skip
        }
        // Filename is `<paneId>.<pid>.<ts>.<rand>.json`; pane ids are UUIDs (no dots).
        const paneId = path.basename(file).split(".")[0] || undefined
        const ev = normalizeHookEvent(raw, paneId)
        if (ev) {
          pending.push(ev)
          schedule()
        }
      })
      .catch(() => {})
  }

  // awaitWriteFinish so we don't read a half-written drop; ignoreInitial since the caller
  // clears stale files before starting (a leftover would replay an old event otherwise).
  const watcher = watch(opts.dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 10 },
  })
  watcher.on("add", ingest)
  await new Promise<void>((resolve) => watcher.on("ready", () => resolve()))

  return {
    close: () => {
      if (timer) clearTimeout(timer)
      return watcher.close()
    },
  }
}
