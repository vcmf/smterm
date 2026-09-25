import { describe, it, expect } from "vitest"
import { claudeProjectDirName, cwdMatchesTranscript } from "./claude-project"

const T = (dir: string) => `/Users/me/.claude/projects/${dir}/552b1de4.jsonl`

describe("claudeProjectDirName", () => {
  it("every non-alphanumeric character becomes '-' (verified against real project folders)", () => {
    expect(claudeProjectDirName("/Users/me/workspace/dimo")).toBe("-Users-me-workspace-dimo")
    expect(claudeProjectDirName("/Users/me/up/asianf/.claude/worktrees/x")).toBe(
      "-Users-me-up-asianf--claude-worktrees-x",
    )
    expect(claudeProjectDirName("C:\\Users\\me\\repo")).toBe("C--Users-me-repo")
  })
})

describe("cwdMatchesTranscript", () => {
  it("the session's own folder matches; a trailing slash doesn't matter", () => {
    expect(cwdMatchesTranscript("/Users/me/workspace/dimo", T("-Users-me-workspace-dimo"))).toBe(
      true,
    )
    expect(cwdMatchesTranscript("/Users/me/workspace/dimo/", T("-Users-me-workspace-dimo"))).toBe(
      true,
    )
  })
  it("a background agent's scratchpad (or a subfolder) doesn't", () => {
    const pad = "/private/tmp/claude-501/-Users-me-workspace-dimo/7aaf8a32/scratchpad"
    expect(cwdMatchesTranscript(pad, T("-Users-me-workspace-dimo"))).toBe(false)
    expect(
      cwdMatchesTranscript("/Users/me/workspace/dimo/src", T("-Users-me-workspace-dimo")),
    ).toBe(false)
  })
  it("a worktree session re-filed under the worktree's folder matches the worktree", () => {
    const wt = "/Users/me/up/asianf/.claude/worktrees/x"
    expect(cwdMatchesTranscript(wt, T("-Users-me-up-asianf--claude-worktrees-x"))).toBe(true)
  })
  it("can't tell (undefined): no transcript, not a projects path, or a very long name", () => {
    expect(cwdMatchesTranscript("/r", undefined)).toBeUndefined()
    expect(cwdMatchesTranscript("/r", "/tmp/a.jsonl")).toBeUndefined()
    const long = "/" + "a".repeat(250)
    expect(cwdMatchesTranscript(long, T("x"))).toBeUndefined()
  })
  it("Windows transcript paths", () => {
    const t = "C:\\Users\\me\\.claude\\projects\\C--Users-me-repo\\1.jsonl"
    expect(cwdMatchesTranscript("C:\\Users\\me\\repo", t)).toBe(true)
  })
})
