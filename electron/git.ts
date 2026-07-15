import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs"
import path from "node:path"

const exec = promisify(execFile)

export type ChangeStatus = "M" | "A" | "D" | "R" | "?"

export interface GitFile {
  path: string // repo-relative
  name: string // basename
  dir: string // parent dir (repo-relative)
  status: ChangeStatus
  add: number
  del: number
}

export interface GitStatus {
  isRepo: boolean
  root: string // repo toplevel (abs); "" when not a repo. Resolves repo-relative file paths.
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
  add: number // totals
  del: number
}

export type DiffLineType = "add" | "del" | "context" | "hunk"

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
}

const empty: GitStatus = {
  isRepo: false,
  root: "",
  branch: "",
  ahead: 0,
  behind: 0,
  files: [],
  add: 0,
  del: 0,
}

/** Parse the `## ...` branch header line of `git status --porcelain -b`. */
export function parseBranchLine(line: string): { branch: string; ahead: number; behind: number } {
  // e.g. "## main...origin/main [ahead 2, behind 1]" | "## main" | "## HEAD (no branch)"
  const body = line.replace(/^## /, "")
  const branch = body.split(/\.\.\.| /)[0] ?? ""
  const ahead = /ahead (\d+)/.exec(body)?.[1]
  const behind = /behind (\d+)/.exec(body)?.[1]
  return { branch, ahead: ahead ? Number(ahead) : 0, behind: behind ? Number(behind) : 0 }
}

/** Reduce a porcelain-v1 XY status pair to one display status. */
export function statusOf(xy: string): ChangeStatus {
  if (xy === "??") return "?"
  const code = xy.replace(/ /g, "")
  if (code.includes("D")) return "D"
  if (code.includes("A")) return "A"
  if (code.includes("R")) return "R"
  return "M"
}

/** Parse `git diff --numstat HEAD` output → path → {add, del}. */
export function parseNumstat(out: string): Map<string, { add: number; del: number }> {
  const map = new Map<string, { add: number; del: number }>()
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [add, del, ...rest] = line.split("\t")
    let file = rest.join("\t")
    // Renames: "old => new" or "dir/{a => b}/f" — take the resulting path.
    if (file.includes(" => ")) file = file.replace(/\{.*? => (.*?)\}/g, "$1").replace(/.* => /, "")
    map.set(file, { add: add === "-" ? 0 : Number(add), del: del === "-" ? 0 : Number(del) })
  }
  return map
}

/** Parse a unified `git diff` into renderable lines with gutter line numbers. */
export function parseDiff(out: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of out.split("\n")) {
    if (raw.startsWith("diff ") || raw.startsWith("index ")) continue
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) continue
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      lines.push({ type: "hunk", text: raw })
      continue
    }
    if (raw.startsWith("\\")) continue // "\ No newline at end of file"
    if (raw.startsWith("+")) lines.push({ type: "add", text: raw.slice(1), newNo: newNo++ })
    else if (raw.startsWith("-")) lines.push({ type: "del", text: raw.slice(1), oldNo: oldNo++ })
    else if (raw.length || lines.length)
      lines.push({ type: "context", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return lines
}

/** Run git inside a WSL distro instead of on the Windows host. A WSL session's
 *  cwd is a Linux path the host can't see, so host git reports "not a git repo". */
export interface WslCtx {
  distro?: string // undefined = the default distro
}

/** `wsl.exe` args to run `git <gitArgs>` in <distro> at Linux <cwd>. Pure — tested.
 *  Uses `--cd` (the same mechanism we spawn WSL shells with). */
export function wslGitArgs(distro: string | undefined, cwd: string, gitArgs: string[]): string[] {
  return [
    ...(distro ? ["-d", distro] : []),
    "--cd",
    cwd,
    "--",
    "git",
    "-c",
    "core.quotepath=false",
    ...gitArgs,
  ]
}

async function run(cwd: string, args: string[], wsl?: WslCtx): Promise<string> {
  const maxBuffer = 20 * 1024 * 1024
  if (wsl) {
    // cwd is a Linux path valid only inside WSL — run git there, not on the host.
    const { stdout } = await exec("wsl.exe", wslGitArgs(wsl.distro, cwd, args), { maxBuffer })
    return stdout
  }
  const { stdout } = await exec("git", ["-c", "core.quotepath=false", ...args], { cwd, maxBuffer })
  return stdout
}

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null"

/** Working-tree status for a directory: branch, ahead/behind, changed files. */
export async function gitStatus(cwd: string, wsl?: WslCtx): Promise<GitStatus> {
  if (!cwd) return empty
  let porcelain: string
  try {
    porcelain = await run(cwd, ["status", "--porcelain=v1", "-b", "--untracked-files=all"], wsl)
  } catch {
    return empty // not a git repo (or git missing)
  }

  const raw = porcelain.split("\n")
  const header = raw.find((l) => l.startsWith("## ")) ?? "## "
  const { branch, ahead, behind } = parseBranchLine(header)

  let numstat = new Map<string, { add: number; del: number }>()
  try {
    numstat = parseNumstat(await run(cwd, ["diff", "--numstat", "HEAD"], wsl))
  } catch {
    // no HEAD yet (empty repo) — counts come from file reads below
  }

  const files: GitFile[] = []
  for (const line of raw) {
    if (!line || line.startsWith("## ")) continue
    const xy = line.slice(0, 2)
    const p = line.slice(3)
    const status = statusOf(xy)
    let counts = numstat.get(p)
    // The untracked-file fallback reads the file off the host fs; a WSL Linux path
    // isn't host-accessible, so skip it there (untracked +count shows 0 on WSL).
    if (!counts)
      counts = { add: status === "?" && !wsl ? countLines(path.join(cwd, p)) : 0, del: 0 }
    files.push({ path: p, name: path.basename(p), dir: path.dirname(p), status, ...counts })
  }

  const add = files.reduce((n, f) => n + f.add, 0)
  const del = files.reduce((n, f) => n + f.del, 0)
  // Repo toplevel — resolves the repo-relative file paths to absolute (files browser
  // decorations, worktree label). Best-effort: "" if it somehow fails.
  let root = ""
  try {
    root = (await run(cwd, ["rev-parse", "--show-toplevel"], wsl)).trim()
  } catch {
    // leave root empty
  }
  return { isRepo: true, root, branch, ahead, behind, files, add, del }
}

/** Unified diff for one file (handles untracked via --no-index). */
export async function gitDiff(cwd: string, file: string, wsl?: WslCtx): Promise<DiffLine[]> {
  if (!cwd || !file) return []
  const nul = wsl ? "/dev/null" : NULL_DEVICE // git runs inside Linux when wsl is set
  try {
    let out = await run(cwd, ["diff", "HEAD", "--", file], wsl)
    if (!out.trim()) {
      // untracked / new file — diff against the null device
      try {
        out = await run(cwd, ["diff", "--no-index", "--", nul, file], wsl)
      } catch (e) {
        // --no-index exits 1 when files differ but still prints the diff
        out = (e as { stdout?: string }).stdout ?? ""
      }
    }
    return parseDiff(out)
  } catch (e) {
    return parseDiff((e as { stdout?: string }).stdout ?? "")
  }
}

function countLines(file: string): number {
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) return 0
    const text = fs.readFileSync(file, "utf8")
    return text.length ? text.split("\n").length : 0
  } catch {
    return 0
  }
}
