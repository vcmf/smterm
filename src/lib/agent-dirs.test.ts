import { describe, it, expect } from "vitest"
import { reduceAgentEvents, type AgentEvent } from "./agent-graph"
import {
  claudeWorkDirs,
  claudeWorkFlat,
  inLabel,
  workCwd,
  worksElsewhere,
  isInside,
  planGitPoll,
  settleInAnswers,
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
    const git = { p: { root: "/r" }, "p@in": { root: "/r/wt", forCwd: "/r/wt" } }
    expect(workCwd(g, git, "p", "/r")).toBe("/r/wt")
    const same = { p: { root: "/r" }, "p@in": { root: "/r", forCwd: "/r/wt" } }
    expect(workCwd(g, same, "p", "/r")).toBe("/r")
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
  const at = (cwd: string, o: object = {}) => ({ forCwd: cwd, ...o }) // an `in` lookup for cwd
  it("undecided (false) until Claude's folder is looked up — no flicker, stale answers ignored", () => {
    expect(worksElsewhere("/r", "/api", { root: "/r" }, undefined)).toBe(false)
    expect(worksElsewhere("/r", "/api", { root: "/r" }, at("/old", { root: "/old" }))).toBe(false)
    expect(worksElsewhere(undefined, "/r", undefined, at("/r"))).toBe(false)
  })
  it("by repo root: symlinks and a `cd src` are the same checkout, a worktree isn't", () => {
    const P = "/private/tmp/p"
    expect(worksElsewhere("/tmp/p", P, { root: P }, at(P, { root: P }))).toBe(false)
    expect(worksElsewhere("/r", "/r/src", { root: "/r" }, at("/r/src", { root: "/r" }))).toBe(false)
    const wt = "/r/.claude/worktrees/a"
    expect(worksElsewhere("/r", wt, { root: "/r" }, at(wt, { root: wt }))).toBe(true)
  })
  it("a repo the shell isn't in (shell outside git, Claude cd'd into a repo below)", () => {
    expect(worksElsewhere("/w", "/w/term", undefined, at("/w/term", { root: "/w/term" }))).toBe(
      true,
    )
  })
  it("outside git: by real path — symlinked spellings and subfolders are the same place", () => {
    const shell = { real: "/private/tmp/x" }
    expect(
      worksElsewhere(
        "/tmp/x",
        "/private/tmp/x",
        shell,
        at("/private/tmp/x", { real: "/private/tmp/x" }),
      ),
    ).toBe(false)
    expect(
      worksElsewhere(
        "/tmp/x",
        "/private/tmp/x/sub",
        shell,
        at("/private/tmp/x/sub", { real: "/private/tmp/x/sub" }),
      ),
    ).toBe(false)
    expect(worksElsewhere("/tmp/x", "/api", shell, at("/api", { real: "/api" }))).toBe(true)
    expect(worksElsewhere("/", "/Users/me", undefined, at("/Users/me"))).toBe(false) // shell at /
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
    expect(inLabel("/", "/Users/me/p", home)).toBe("Users/me/p")
  })
})

describe("helpers", () => {
  it("samePath ignores a trailing slash; git keys round-trip", () => {
    expect(samePath("/a/", "/a")).toBe(true)
    expect(samePath("/", "/")).toBe(true)
    expect(isInside("/a/b", "/a")).toBe(true)
    expect(isInside("/ab", "/a")).toBe(false)
    expect(isInside("/a", "/a/")).toBe(false)
    expect(isInside("C:\\x", "C:\\")).toBe(true)
    expect(paneOfGitKey(inGitKey("p1"))).toBe("p1")
    expect(paneOfGitKey("p1")).toBe("p1")
  })
})

describe("planGitPoll / settleInAnswers", () => {
  const sh = (id: string, cwd?: string) => ({ id, cwd, command: "/bin/zsh", args: [] })
  const work = { b: { cwd: "/b/wt", others: [] }, c: { cwd: "/c", others: [] } }

  it("shell folder per terminal + Claude's when it moved; clears `in` where it didn't", () => {
    const p = planGitPoll([sh("a", "/a"), sh("b", "/b"), sh("c", "/c"), sh("d")], work, false)
    expect(p.reqs.map((r) => `${r.paneId}:${r.cwd}`)).toEqual([
      "a:/a",
      "b:/b",
      "b@in:/b/wt",
      "c:/c",
    ])
    expect(p.polled).toEqual(["a", "a@in", "b", "c", "c@in"])
    expect(p.inCwd).toEqual({ "b@in": "/b/wt" })
  })

  it("sidebar collapsed: only terminals whose Claude moved", () => {
    const p = planGitPoll([sh("a", "/a"), sh("b", "/b")], work, true)
    expect(p.reqs.map((r) => r.paneId)).toEqual(["b", "b@in"])
  })

  it("the 64 cap skips a pair that doesn't fit but still fills with single terminals", () => {
    const many = Array.from({ length: 63 }, (_, i) => sh(`s${i}`, `/s${i}`))
    const p = planGitPoll([...many, sh("b", "/b"), sh("z", "/z")], work, false)
    expect(p.reqs).toHaveLength(64)
    expect(p.reqs[63]?.paneId).toBe("z")
  })

  it("tags answers with their folder; a failed lookup keeps the last answer for it", () => {
    const res: Record<string, { root?: string; forCwd?: string }> = { "b@in": {} }
    settleInAnswers(res, { "b@in": "/b/wt" }, { "b@in": { root: "/b/wt", forCwd: "/b/wt" } })
    expect(res).toEqual({}) // kept (not overwritten)
    const fresh: Record<string, { root?: string; forCwd?: string }> = { "b@in": { root: "/b/wt" } }
    settleInAnswers(fresh, { "b@in": "/b/wt" }, {})
    expect(fresh["b@in"]?.forCwd).toBe("/b/wt")
  })
})
