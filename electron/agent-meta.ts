// Live per-pane Claude session metadata (`/color`, `/rename`) for the pane accent. Claude's
// slash commands fire no hook, so besides refreshing on the pane's hook events we watch that
// one transcript file and re-read (incrementally) on append — debounced, async, in the main
// process: nothing here touches the PTY → renderer path.

import fs from "node:fs"
import { TranscriptMeta, type SessionMeta } from "./transcript-meta"

/** Start watching the first reachable candidate; `onChange` on writes, `onError` if the watch
 *  dies (file replaced, share hiccup). Returns a stop function, or null if nothing could be
 *  watched yet (hook events still refresh; the watch is retried, throttled). */
export type WatchFn = (
  candidates: string[],
  onChange: () => void,
  onError: () => void,
) => (() => void) | null

export const fsWatch: WatchFn = (candidates, onChange, onError) => {
  for (const c of candidates) {
    try {
      const w = fs.watch(c, { persistent: false }, onChange)
      w.on("error", () => {
        w.close()
        onError()
      })
      return () => w.close()
    } catch {
      // missing (transcript not created yet) / unwatchable (some WSL shares) — try the next
    }
  }
  return null
}

interface PaneWatch {
  key: string // the transcript path the hook reported (reader state key)
  candidates: string[] // reachable host paths for it (WSL: UNC shares)
  stop: (() => void) | null
  lastWatchTry: number // ms — throttles re-trying an unwatchable file on every hook event
  timer?: ReturnType<typeof setTimeout>
  last?: SessionMeta
}

// An unwatchable file (WSL share) would otherwise re-run sync fs.watch attempts on every
// hook event of a tool-heavy turn.
const WATCH_RETRY_MS = 5000

const sameMeta = (a: SessionMeta | undefined, b: SessionMeta | undefined) =>
  a?.color === b?.color && a?.name === b?.name

const hasMeta = (m: SessionMeta | undefined) => !!m && (m.color !== undefined || !!m.name)

/** Tracks each Claude pane's transcript metadata and emits it on change (null = gone). */
export class AgentMetaTracker {
  private panes = new Map<string, PaneWatch>()

  constructor(
    private readonly emit: (paneId: string, meta: SessionMeta | null) => void,
    private readonly watch: WatchFn = fsWatch,
    private readonly debounceMs = 200,
    private readonly reader = new TranscriptMeta(),
    private readonly now: () => number = Date.now,
  ) {}

  /** A hook event from `paneId` referencing its session transcript: start (or refresh)
   *  tracking. A different transcript in the same pane = a new claude session → restart,
   *  clearing the old session's accent first (it may have died without a SessionEnd). */
  track(paneId: string, key: string, candidates: string[] = [key]): void {
    let p = this.panes.get(paneId)
    if (p && p.key !== key) {
      this.untrack(paneId)
      p = undefined
    }
    if (!p) {
      p = { key, candidates, stop: null, lastWatchTry: -Infinity }
      this.panes.set(paneId, p)
    }
    this.ensureWatch(paneId, p)
    this.schedule(paneId)
  }

  /** Claude left the pane (SessionEnd) or the pane/PTY ended: stop watching, clear the accent.
   *  With `key`, only if that transcript is still the tracked one — a late SessionEnd of the
   *  previous session (drops are ingested unordered) must not end the new one. */
  untrack(paneId: string, notify = true, key?: string): void {
    const p = this.panes.get(paneId)
    if (!p || (key !== undefined && p.key !== key)) return
    p.stop?.()
    clearTimeout(p.timer)
    this.reader.forget(p.key)
    this.panes.delete(paneId)
    if (notify && hasMeta(p.last)) this.emit(paneId, null)
  }

  /** Current metadata of every tracked pane — a freshly (re)loaded renderer has none. */
  snapshot(): [string, SessionMeta][] {
    const out: [string, SessionMeta][] = []
    for (const [id, p] of this.panes) if (hasMeta(p.last)) out.push([id, p.last!])
    return out
  }

  dispose(): void {
    for (const id of [...this.panes.keys()]) this.untrack(id, false)
  }

  private ensureWatch(paneId: string, p: PaneWatch): void {
    if (p.stop || this.now() - p.lastWatchTry < WATCH_RETRY_MS) return
    p.lastWatchTry = this.now()
    p.stop = this.watch(
      p.candidates,
      () => this.schedule(paneId),
      () => {
        // The watch died: drop it so the next event re-arms it (no throttle wait).
        if (this.panes.get(paneId) !== p) return
        p.stop = null
        p.lastWatchTry = -Infinity
      },
    )
  }

  // Coalesce bursts (a hook storm, or several appends while Claude writes a turn).
  private schedule(paneId: string): void {
    const p = this.panes.get(paneId)
    if (!p) return
    clearTimeout(p.timer)
    p.timer = setTimeout(() => void this.refresh(paneId, p), this.debounceMs)
  }

  private async refresh(paneId: string, p: PaneWatch): Promise<void> {
    const meta = await this.reader.update(p.key, p.candidates)
    if (this.panes.get(paneId) !== p) return // untracked / restarted meanwhile
    if (sameMeta(meta, p.last)) return
    const had = hasMeta(p.last)
    p.last = meta
    if (hasMeta(meta)) this.emit(paneId, meta)
    else if (had) this.emit(paneId, null)
  }
}
