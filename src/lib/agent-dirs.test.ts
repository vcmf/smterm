import { describe, it, expect } from "vitest"
import { reduceAgentEvents, type AgentEvent } from "./agent-graph"
import { claudeWorkDirs, inLabel, workCwd, samePath, inGitKey, paneOfGitKey } from "./agent-dirs"

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

  it("workCwd: Claude's folder while it runs, else the shell's", () => {
    const g = graph([{ event: "SessionStart", sessionId: "s", paneId: "p", cwd: "/r/wt" }])
    expect(workCwd(g, "p", "/r")).toBe("/r/wt")
    expect(workCwd(g, "other", "/x")).toBe("/x")
  })
})

describe("inLabel", () => {
  const home = "/Users/me"
  it("one line (undefined) when Claude works where it started, or a side is unknown", () => {
    expect(inLabel("/r", "/r/", home)).toBeUndefined()
    expect(inLabel(undefined, "/r", home)).toBeUndefined()
    expect(inLabel("/r", undefined, home)).toBeUndefined()
  })
  it("relative inside `from`; ~-shortened elsewhere (another repo)", () => {
    expect(inLabel("/Users/me/term", "/Users/me/term/.claude/worktrees/x", home)).toBe(
      ".claude/worktrees/x",
    )
    expect(inLabel("/Users/me/term", "/Users/me/term-api", home)).toBe("~/term-api") // not a child
    expect(inLabel("C:\\r", "C:\\r\\wt", home)).toBe("wt")
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
