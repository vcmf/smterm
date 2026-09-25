import { describe, it, expect } from "vitest"
import { reduceAgentEvents, type AgentEvent } from "./agent-graph"
import {
  claudeWorkDirs,
  claudeWorkFlat,
  inLabel,
  workCwd,
  worksElsewhere,
  samePath,
  inGitKey,
  paneOfGitKey,
} from "./agent-dirs"

const graph = (events: AgentEvent[]) => reduceAgentEvents(events)

describe("claudeWorkDirs", () => {
  it("follows the session's cwd: SessionStart, then CwdChanged (entering a worktree)", () => {
    const g = graph([
      { event: "SessionStart", sessionId: "s", paneId: "p", cwd: "/r" },
      { event: "CwdChanged", sessionId: "s", paneId: "p", cwd: "/r/.claude/worktrees/a" },
    ])
    expect(claudeWorkDirs(g).p?.cwd).toBe("/r/.claude/worktrees/a")
  })

  it("other worktrees exclude the one Claude is in; the newest session of a pane wins", () => {
    const g = graph([
      { event: "SessionStart", sessionId: "old", paneId: "p", cwd: "/old" },
      { event: "SessionStart", sessionId: "s", paneId: "p", cwd: "/r" },
      { event: "WorktreeCreate", sessionId: "s", paneId: "p", worktreePath: "/r/wt/a" },
      { event: "WorktreeCreate", sessionId: "s", paneId: "p", worktreePath: "/r/wt/b" },
      { event: "CwdChanged", sessionId: "s", paneId: "p", cwd: "/r/wt/a/" },
    ])
    const d = claudeWorkDirs(g).p
    expect(d?.cwd).toBe("/r/wt/a/")
    expect(d?.others.map((w) => w.path)).toEqual(["/r/wt/b"])
  })

  it("no entry without a pane or a known cwd; memoized per graph", () => {
    const g = graph([
      { event: "SessionStart", sessionId: "a" }, // outside smterm's panes
      { event: "Stop", sessionId: "b", paneId: "p" }, // root without a cwd yet
    ])
    expect(claudeWorkDirs(g)).toEqual({})
    expect(claudeWorkDirs(g)).toBe(claudeWorkDirs(g))
  })

  it("workCwd: Claude's folder while it works in another checkout, else the shell's", () => {
    const g = graph([{ event: "SessionStart", sessionId: "s", paneId: "p", cwd: "/r/wt" }])
    const git = { p: { root: "/r" }, "p@in": { root: "/r/wt" } }
    expect(workCwd(g, git, "p", "/r")).toBe("/r/wt")
    expect(workCwd(g, { p: { root: "/r" }, "p@in": { root: "/r" } }, "p", "/r")).toBe("/r")
    expect(workCwd(g, {}, "other", "/x")).toBe("/x")
  })

  it("the newest-started session of a pane wins, even one resumed from another pane", () => {
    const g = graph([
      { event: "SessionStart", sessionId: "a", paneId: "p", cwd: "/a" },
      { event: "SessionStart", sessionId: "b", paneId: "q", cwd: "/b" },
      { event: "SessionStart", sessionId: "a", paneId: "q", cwd: "/a2" }, // resumed in q
    ])
    expect(claudeWorkDirs(g).q?.cwd).toBe("/a2")
    expect(claudeWorkFlat(g)).toBe(claudeWorkFlat(g))
    expect(claudeWorkFlat(g)).toEqual(["q", "/a2", ""])
  })
})

describe("worksElsewhere", () => {
  it("by repo root when both are known: symlinks and a `cd src` are the same checkout", () => {
    expect(
      worksElsewhere(
        "/tmp/p",
        "/private/tmp/p",
        { root: "/private/tmp/p" },
        { root: "/private/tmp/p" },
      ),
    ).toBe(false)
    expect(worksElsewhere("/r", "/r/src", { root: "/r" }, { root: "/r" })).toBe(false)
    expect(
      worksElsewhere(
        "/r",
        "/r/.claude/worktrees/a",
        { root: "/r" },
        { root: "/r/.claude/worktrees/a" },
      ),
    ).toBe(true)
  })
  it("otherwise by path: a subfolder is the same place, another folder isn't", () => {
    expect(worksElsewhere("/r", "/r/src", undefined, undefined)).toBe(false)
    expect(worksElsewhere("/r", "/api", undefined, undefined)).toBe(true)
    expect(worksElsewhere("/r", "/r/", { root: "/r" }, undefined)).toBe(false)
    expect(worksElsewhere(undefined, "/r", undefined, undefined)).toBe(false)
  })
})

describe("inLabel", () => {
  const home = "/Users/me"
  it("relative inside `from`; ~-shortened elsewhere (another repo)", () => {
    expect(inLabel("/Users/me/term", "/Users/me/term/.claude/worktrees/x", home)).toBe(
      ".claude/worktrees/x",
    )
    expect(inLabel("/Users/me/term", "/Users/me/term-api", home)).toBe("~/term-api") // not a child
    expect(inLabel("C:\\r", "C:\\r\\wt", home)).toBe("wt")
    // shell on the logical /tmp path, Claude on the physical one: relative to the repo root
    expect(inLabel("/tmp/r", "/private/tmp/r/wt/a", home, "/private/tmp/r")).toBe("wt/a")
  })
})

describe("helpers", () => {
  it("samePath ignores a trailing slash; git keys round-trip", () => {
    expect(samePath("/a/", "/a")).toBe(true)
    expect(samePath("/", "/")).toBe(true)
    expect(paneOfGitKey(inGitKey("p1"))).toBe("p1")
    expect(paneOfGitKey("p1")).toBe("p1")
  })
})
