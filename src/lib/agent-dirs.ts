// Where a pane's Claude session works vs where it started. The shell's folder (`from`) is
// where Claude saves the session; Claude's own cwd (`in`) moves with worktrees and `cd`s.
// Pure — the sidebar, the branch/PR poll and the changes panel share these rules.
import type { AgentGraph, Worktree } from "./agent-graph"
import type { PaneGitInfo } from "./pane-git"
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
    out[n.paneId] = { cwd, others } // later roots win: SessionStart moves a root to the end
  }
  memo.set(graph, out)
  return out
}

const flatMemo = new WeakMap<AgentGraph, string[]>()

/** claudeWorkDirs as [paneId, cwd, other worktree paths "\n"-joined, …] — primitives for a
 *  shallow-compared selector; memoized per graph. */
export function claudeWorkFlat(graph: AgentGraph): string[] {
  const hit = flatMemo.get(graph)
  if (hit) return hit
  const out = Object.entries(claudeWorkDirs(graph)).flatMap(([id, d]) => [
    id,
    d.cwd,
    d.others.map((w) => w.path).join("\n"),
  ])
  flatMemo.set(graph, out)
  return out
}

/** Is Claude working in another checkout than the shell's? Compared by repo root (symlinks
 *  resolved, and a plain `cd src` stays the same repo); outside git, by path — a subfolder of
 *  the shell's folder counts as the same place. Until `in` is looked up: path rule. */
export function worksElsewhere(
  shellCwd: string | undefined,
  work: string | undefined,
  shellGit: PaneGitInfo | undefined,
  inGit: PaneGitInfo | undefined,
): boolean {
  if (!shellCwd || !work || samePath(shellCwd, work)) return false
  if (shellGit?.root && inGit?.root) return !samePath(shellGit.root, inGit.root)
  const from = trim(shellCwd)
  return !trim(work).startsWith(from + (from.includes("\\") ? "\\" : "/"))
}

/** The folder a pane works in: Claude's while it works in another checkout, else the shell's. */
export function workCwd(
  graph: AgentGraph,
  paneGit: Record<string, PaneGitInfo>,
  paneId: string,
  shellCwd?: string,
): string | undefined {
  const work = claudeWorkDirs(graph)[paneId]?.cwd
  return worksElsewhere(shellCwd, work, paneGit[paneId], paneGit[inGitKey(paneId)])
    ? work
    : shellCwd
}

/** The `in` line's path: relative to `from` (or its repo root — symlinks resolved) when inside
 *  it (`.claude/worktrees/x`), else `~`-shortened. */
export function inLabel(shellCwd: string, work: string, home: string, fromRoot?: string): string {
  const to = trim(work)
  for (const base of fromRoot ? [shellCwd, fromRoot] : [shellCwd]) {
    const from = trim(base)
    const sep = from.includes("\\") ? "\\" : "/"
    if (to.startsWith(from + sep)) return to.slice(from.length + 1)
  }
  return shortCwd(to, home)
}

/** paneGit key for a pane's `in` folder (the shell's folder uses the bare pane id). */
export const inGitKey = (paneId: string) => `${paneId}@in`

/** The pane a paneGit key belongs to. */
export const paneOfGitKey = (key: string) => (key.endsWith("@in") ? key.slice(0, -3) : key)
