// Where a pane's Claude session works vs where it started. The shell's folder (`from`) is
// where Claude saves the session; Claude's own cwd (`in`) moves with worktrees and `cd`s.
// Pure — the sidebar, the branch/PR poll and the changes panel share these rules.
import type { AgentGraph, Worktree } from "./agent-graph"
import { shortCwd } from "./session-label"

/** A live Claude session's working folder + the session's other worktrees. */
export interface WorkDir {
  cwd: string
  others: Worktree[]
}

const trim = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p)

/** Same folder, ignoring a trailing slash. */
export const samePath = (a: string, b: string): boolean => trim(a) === trim(b)

const memo = new WeakMap<AgentGraph, Record<string, WorkDir>>()

/** Per pane: its newest live Claude session's cwd + other worktrees; memoized per graph. */
export function claudeWorkDirs(graph: AgentGraph): Record<string, WorkDir> {
  const hit = memo.get(graph)
  if (hit) return hit
  const out: Record<string, WorkDir> = {}
  for (const rid of graph.rootIds) {
    const n = graph.nodes[rid]
    if (!n?.paneId || !n.cwd) continue
    const cwd = n.cwd
    const others = (n.worktrees ?? []).filter((w) => !samePath(w.path, cwd))
    out[n.paneId] = { cwd, others } // later roots win: rootIds is in start order
  }
  memo.set(graph, out)
  return out
}

/** The folder a pane works in: Claude's while it runs there, else the shell's. */
export function workCwd(graph: AgentGraph, paneId: string, shellCwd?: string): string | undefined {
  return claudeWorkDirs(graph)[paneId]?.cwd ?? shellCwd
}

/** The `in` line's path, or undefined when Claude works in the shell's own folder (one line).
 *  Relative to `from` when inside it (`.claude/worktrees/x`), else `~`-shortened. */
export function inLabel(
  shellCwd: string | undefined,
  work: string | undefined,
  home: string,
): string | undefined {
  if (!shellCwd || !work || samePath(shellCwd, work)) return undefined
  const from = trim(shellCwd)
  const to = trim(work)
  const sep = from.includes("\\") ? "\\" : "/"
  if (to.startsWith(from + sep)) return to.slice(from.length + 1)
  return shortCwd(to, home)
}

/** paneGit key for a pane's `in` folder (the shell's folder uses the bare pane id). */
export const inGitKey = (paneId: string) => `${paneId}@in`

/** The pane a paneGit key belongs to. */
export const paneOfGitKey = (key: string) => (key.endsWith("@in") ? key.slice(0, -3) : key)
