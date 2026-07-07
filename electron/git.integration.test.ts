import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitStatus, gitDiff } from "./git"

// Real-git integration: build a throwaway repo and exercise gitStatus/gitDiff
// end-to-end (the pure parsers are covered separately in git.test.ts).

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" })

describe.skipIf(!hasGit)("git module (real repo)", () => {
  let repo = ""
  let plain = ""

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "smterm-git-"))
    git(repo, "-c", "init.defaultBranch=main", "init")
    git(repo, "config", "user.email", "t@t.dev")
    git(repo, "config", "user.name", "Test")
    git(repo, "config", "commit.gpgsign", "false")
    fs.writeFileSync(path.join(repo, "a.txt"), "line1\nline2\nline3\n")
    git(repo, "add", "a.txt")
    git(repo, "commit", "-m", "init")
    // Modify a tracked file (1 del + 1 add) and add an untracked file.
    fs.writeFileSync(path.join(repo, "a.txt"), "line1\nline2-changed\nline3\n")
    fs.writeFileSync(path.join(repo, "new.txt"), "hello\nworld\n")

    plain = fs.mkdtempSync(path.join(os.tmpdir(), "smterm-plain-"))
  })

  afterAll(() => {
    for (const d of [repo, plain]) if (d) fs.rmSync(d, { recursive: true, force: true })
  })

  it("reports branch + changed files with +/- counts", async () => {
    const s = await gitStatus(repo)
    expect(s.isRepo).toBe(true)
    expect(s.branch).toBe("main")

    const modified = s.files.find((f) => f.path === "a.txt")
    expect(modified).toMatchObject({ status: "M", add: 1, del: 1 })

    const untracked = s.files.find((f) => f.path === "new.txt")
    expect(untracked?.status).toBe("?")
    expect(untracked?.add).toBeGreaterThan(0)

    expect(s.add).toBeGreaterThanOrEqual(1)
    expect(s.del).toBe(1)
  })

  it("produces a unified diff for a modified file", async () => {
    const lines = await gitDiff(repo, "a.txt")
    expect(lines.some((l) => l.type === "hunk")).toBe(true)
    expect(lines.some((l) => l.type === "del" && l.text === "line2")).toBe(true)
    expect(lines.some((l) => l.type === "add" && l.text === "line2-changed")).toBe(true)
    expect(lines.some((l) => l.type === "context" && l.text === "line1")).toBe(true)
  })

  it("produces an all-additions diff for an untracked file", async () => {
    const lines = await gitDiff(repo, "new.txt")
    const adds = lines.filter((l) => l.type === "add").map((l) => l.text)
    expect(adds).toEqual(expect.arrayContaining(["hello", "world"]))
  })

  it("returns isRepo:false for a non-git directory", async () => {
    expect((await gitStatus(plain)).isRepo).toBe(false)
    expect(await gitDiff(plain, "whatever")).toEqual([])
  })

  it("returns isRepo:false for an empty cwd", async () => {
    expect((await gitStatus("")).isRepo).toBe(false)
  })
})
