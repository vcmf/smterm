import { describe, it, expect } from "vitest"
import { buildGitDecorations, statusLetter, statusColor } from "./git-decorations"
import type { GitFile, ChangeStatus } from "./ipc"

const f = (p: string, status: ChangeStatus): GitFile => ({
  path: p,
  name: p.split("/").pop()!,
  dir: p.split("/").slice(0, -1).join("/"),
  status,
  add: 0,
  del: 0,
})

describe("buildGitDecorations", () => {
  it("maps changed files to absolute paths with their status", () => {
    const d = buildGitDecorations("/repo", [f("src/app.ts", "M"), f("README.md", "?")])
    expect(d.file.get("/repo/src/app.ts")).toBe("M")
    expect(d.file.get("/repo/README.md")).toBe("?")
  })

  it("rolls a change up through every ancestor folder, stopping at repoRoot", () => {
    const d = buildGitDecorations("/repo", [f("a/b/c/x.ts", "M")])
    expect(d.dir.get("/repo/a/b/c")).toBe("M")
    expect(d.dir.get("/repo/a/b")).toBe("M")
    expect(d.dir.get("/repo/a")).toBe("M")
    expect(d.dir.get("/repo")).toBe("M")
    expect(d.dir.has("/")).toBe(false) // never above repoRoot
  })

  it("aggregates a folder to its most-severe contained change", () => {
    // src has an added and a modified file → modified wins; deleted outranks all.
    const d = buildGitDecorations("/repo", [
      f("src/a.ts", "A"),
      f("src/b.ts", "M"),
      f("src/c.ts", "D"),
    ])
    expect(d.dir.get("/repo/src")).toBe("D")

    const d2 = buildGitDecorations("/repo", [f("src/a.ts", "A"), f("src/b.ts", "M")])
    expect(d2.dir.get("/repo/src")).toBe("M")

    const d3 = buildGitDecorations("/repo", [f("src/a.ts", "?"), f("src/b.ts", "A")])
    expect(d3.dir.get("/repo/src")).toBe("A") // added outranks untracked
  })

  it("handles a repo root with subdirectories deeper than the browser cwd", () => {
    // repoRoot=/repo, a change in /repo/pkg/sub — all ancestors down to /repo marked.
    const d = buildGitDecorations("/repo", [f("pkg/sub/x", "A")])
    expect([...d.dir.keys()].sort()).toEqual(["/repo", "/repo/pkg", "/repo/pkg/sub"])
  })

  it("empty repoRoot (not a repo) → empty decorations", () => {
    const d = buildGitDecorations("", [f("x.ts", "M")])
    expect(d.file.size).toBe(0)
    expect(d.dir.size).toBe(0)
  })

  it("does not mutate across calls / is deterministic", () => {
    const files = [f("src/a.ts", "M")]
    const a = buildGitDecorations("/repo", files)
    const b = buildGitDecorations("/repo", files)
    expect([...a.file]).toEqual([...b.file])
    expect([...a.dir]).toEqual([...b.dir])
  })
})

describe("statusLetter / statusColor", () => {
  it("untracked shows as U; others are themselves", () => {
    expect(statusLetter("?")).toBe("U")
    expect(statusLetter("M")).toBe("M")
    expect(statusLetter("A")).toBe("A")
    expect(statusLetter("D")).toBe("D")
  })
  it("maps each status to a theme color", () => {
    expect(statusColor("M")).toContain("--amber")
    expect(statusColor("A")).toContain("--accent")
    expect(statusColor("?")).toContain("--accent")
    expect(statusColor("D")).toContain("--red")
    expect(statusColor("R")).toContain("--blue")
  })
})
