// Where a pane's Claude session works vs where it started. The shell's folder (`from`) is
// where Claude saves the session; Claude's own cwd (`in`) moves with worktrees and `cd`s.
// Pure — the sidebar, the branch/PR poll and the changes panel share these rules.
import type { AgentGraph, Worktree } from "./agent-graph"
import type { PaneGitInfo, PaneGitRequest } from "./pane-git"
import type { Session } from "../types"
import { wslContext } from "./wsl"
import { shortCwd } from "./session-label"
import { normalizeRootPath } from "./breadcrumb"

/** A live Claude session's working folder + the session's other worktrees. */
export interface WorkDir {
  cwd: string
  others: Worktree[]
}

/** Same folder, ignoring a trailing separator. */
export const samePath = (a: string, b: string): boolean =>
  normalizeRootPath(a) === normalizeRootPath(b)

/** `child` is strictly inside `parent` (a root like "/" or "C:\\" included). */
export function isInside(child: string, parent: string): boolean {
  const p = normalizeRootPath(parent)
  const c = normalizeRootPath(child)
  const sep = p.includes("\\") ? "\\" : "/"
  const prefix = p.endsWith(sep) ? p : p + sep
  return c !== p && c.startsWith(prefix)
}

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

/** Claude's `in` lookup, if it's for the folder Claude is in now (it moves; a stale or
 *  missing answer means "not known yet"). */
export const inGitFor = (inGit: PaneGitInfo | undefined, work: string | undefined) =>
  inGit && work && inGit.forCwd === work ? inGit : undefined

/** Is Claude working in another checkout than the shell's? Decided only once Claude's folder
 *  has been looked up (no flicker): a different repo root, or a repo the shell isn't in →
 *  yes; same root (a `cd src`) → no; outside git → by real path (symlinks resolved), where a
 *  subfolder of the shell's folder is the same place. */
export function worksElsewhere(
  shellCwd: string | undefined,
  work: string | undefined,
  shellGit: PaneGitInfo | undefined,
  inGit: PaneGitInfo | undefined,
): boolean {
  const known = inGitFor(inGit, work)
  if (!shellCwd || !work || !known || samePath(shellCwd, work)) return false
  if (known.root) return !(shellGit?.root && samePath(shellGit.root, known.root))
  const from = shellGit?.real ?? shellCwd
  const to = known.real ?? work
  return !samePath(from, to) && !isInside(to, from)
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

/** The `in` line's path: relative to `from` when inside it (`.claude/worktrees/x`) — also via
 *  `from`'s real path (shell on a symlink, Claude on the resolved path) — else `~`-shortened. */
export function inLabel(shellCwd: string, work: string, home: string, fromReal?: string): string {
  const to = normalizeRootPath(work)
  for (const base of fromReal ? [shellCwd, fromReal] : [shellCwd]) {
    const from = normalizeRootPath(base)
    if (isInside(to, from)) return to.slice(from.length).replace(/^[\\/]/, "")
  }
  return shortCwd(to, home)
}

/** paneGit key for a pane's `in` folder (the shell's folder uses the bare pane id). */
export const inGitKey = (paneId: string) => `${paneId}@in`

/** The pane a paneGit key belongs to. */
export const paneOfGitKey = (key: string) => (key.endsWith("@in") ? key.slice(0, -3) : key)

/** One branch/PR poll: per terminal its shell folder, then Claude's folder when it differs
 *  (the `in` lookup). Paired so the 64 cap drops whole terminals. Sidebar collapsed: only
 *  terminals whose Claude moved — the status bar / changes / Files panels need that answer.
 *  `polled` = keys this poll speaks for (an `in` no longer asked for gets cleared). */
export function planGitPoll(
  sessions: Pick<Session, "id" | "cwd" | "command" | "args">[],
  work: Record<string, WorkDir>,
  onlyIn: boolean,
): { reqs: PaneGitRequest[]; polled: string[]; inCwd: Record<string, string> } {
  const reqs: PaneGitRequest[] = []
  const polled: string[] = []
  const inCwd: Record<string, string> = {}
  for (const x of sessions) {
    if (!x.cwd) continue
    const w = work[x.id]?.cwd
    const moved = !!w && !samePath(w, x.cwd)
    if ((onlyIn && !moved) || reqs.length + (moved ? 2 : 1) > 64) continue // main answers ≤ 64
    const wsl = wslContext(x.command, x.args)
    reqs.push({ paneId: x.id, cwd: x.cwd, wsl })
    polled.push(x.id)
    if (moved) {
      reqs.push({ paneId: inGitKey(x.id), cwd: w, wsl })
      inCwd[inGitKey(x.id)] = w
    } else polled.push(inGitKey(x.id))
  }
  return { reqs, polled, inCwd }
}

/** Tag each `in` answer with its folder (mutates `res`). A failed lookup (nothing resolved)
 *  keeps the last answer for that folder, so panels following Claude's checkout don't flip. */
export function settleInAnswers(
  res: Record<string, PaneGitInfo>,
  inCwd: Record<string, string>,
  known: Record<string, PaneGitInfo>,
): void {
  for (const [key, cwd] of Object.entries(inCwd)) {
    const r = res[key]
    if (!r || (!r.root && !r.real && known[key]?.forCwd === cwd)) delete res[key]
    else r.forCwd = cwd
  }
}
