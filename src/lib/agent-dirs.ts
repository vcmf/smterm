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
  const newest: Record<string, number> = {}
  for (const rid of graph.rootIds) {
    const n = graph.nodes[rid]
    if (!n?.paneId || !n.cwd) continue
    if ((n.started ?? 0) < (newest[n.paneId] ?? -1)) continue // an older session of the pane
    newest[n.paneId] = n.started ?? 0
    const cwd = n.cwd
    const others = (n.worktrees ?? []).filter((w) => !samePath(w.path, cwd))
    out[n.paneId] = { cwd, others }
  }
  memo.set(graph, out)
  return out
}

const flatMemo = new WeakMap<AgentGraph, string[]>()

/** claudeWorkDirs flattened to primitives [paneId, cwd, others…] for useShallow; memoized. */
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

/** Claude's `in` lookup if it still applies: asked for this folder, or Claude is inside its repo. */
export function inGitFor(inGit: PaneGitInfo | undefined, work: string | undefined) {
  if (!inGit || !work) return undefined
  if (inGit.forCwd === work) return inGit
  return inGit.root && (samePath(work, inGit.root) || isInside(work, inGit.root))
    ? inGit
    : undefined
}

/** Claude works in another checkout: other repo root, or by real path outside git; unknown → no. */
export function worksElsewhere(
  shellCwd: string | undefined,
  work: string | undefined,
  shellGit: PaneGitInfo | undefined,
  inGit: PaneGitInfo | undefined,
): boolean {
  const known = inGitFor(inGit, work)
  if (!shellCwd || !work || !known || samePath(shellCwd, work)) return false
  if (known.root) return !(shellGit?.root && samePath(shellGit.root, known.root))
  // Outside git: symlinked spellings and subfolders of the shell's folder are the same place.
  const from = shellGit?.real ?? shellCwd
  const to = known.real ?? work
  return !samePath(from, to) && !isInside(to, from)
}

/** The folder a pane's git views follow: Claude's checkout root while it works elsewhere. */
export function workCwd(
  graph: AgentGraph,
  paneGit: Record<string, PaneGitInfo>,
  paneId: string,
  shellCwd?: string,
): string | undefined {
  const work = claudeWorkDirs(graph)[paneId]?.cwd
  const inGit = paneGit[inGitKey(paneId)]
  if (!worksElsewhere(shellCwd, work, paneGit[paneId], inGit)) return shellCwd
  return inGit?.root ?? work // the checkout, not Claude's current subfolder (stable views)
}

/** The `in` path: relative to `from` (or its real path) when inside it, else `~`-shortened. */
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

/** One poll's requests: shell folder + Claude's when it moved, paired under the 64 cap. */
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
    if (!moved) polled.push(inGitKey(x.id)) // Claude left (or never moved): clear its `in`
    // Sidebar collapsed: only moved terminals (the status bar / panels follow Claude's
    // checkout) and no PR lookups — nothing on screen shows a PR.
    if ((onlyIn && !moved) || reqs.length + (moved ? 2 : 1) > 64) continue // main answers ≤ 64
    const wsl = wslContext(x.command, x.args)
    const noPr = onlyIn || undefined
    reqs.push({ paneId: x.id, cwd: x.cwd, wsl, noPr })
    polled.push(x.id)
    if (moved) {
      reqs.push({ paneId: inGitKey(x.id), cwd: w, wsl, noPr })
      inCwd[inGitKey(x.id)] = w
    }
  }
  return { reqs, polled, inCwd }
}

/** Tag `in` answers with their folder; a failed lookup keeps the last one (once, not forever). */
export function settleInAnswers(
  res: Record<string, PaneGitInfo>,
  inCwd: Record<string, string>,
  known: Record<string, PaneGitInfo>,
): void {
  for (const [key, cwd] of Object.entries(inCwd)) {
    const r = res[key]
    const prev = known[key]
    if (!r) delete res[key]
    // Nothing resolved: a hiccup, or the folder really left git (WSL has no real path) —
    // keep the last answer for one poll only.
    else if (!r.root && !r.real && prev?.forCwd === cwd && !prev.kept)
      res[key] = { ...prev, kept: true }
    else r.forCwd = cwd
  }
}
