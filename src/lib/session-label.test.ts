import { describe, it, expect } from "vitest"
import { tabTitle, shortCwd, sessionSubline } from "./session-label"
import type { Session, Tab } from "../types"

const mk = (id: string, title: string, cwd?: string): Session => ({
  id,
  title,
  command: "/bin/zsh",
  args: [],
  status: "idle",
  unread: false,
  cwd,
})
const tab = (title: string, activeSessionId: string): Tab => ({
  id: "t",
  title,
  root: { type: "leaf", sessionId: activeSessionId },
  activeSessionId,
})

describe("tabTitle", () => {
  it("uses the manual pin when set", () => {
    expect(tabTitle(tab("Build", "s"), { s: mk("s", "zsh") })).toBe("Build")
  })
  it("falls back to the focused pane's live title when unpinned", () => {
    expect(tabTitle(tab("", "s"), { s: mk("s", "claude: fix auth") })).toBe("claude: fix auth")
  })
  it("falls back to 'shell' when nothing is known", () => {
    expect(tabTitle(tab("", "gone"), {})).toBe("shell")
  })
})

describe("shortCwd", () => {
  const home = "/Users/me"
  it("collapses $HOME to ~", () => {
    expect(shortCwd("/Users/me/src/app", home)).toBe("~/src/app")
    expect(shortCwd("/Users/me", home)).toBe("~")
  })
  it("leaves non-home paths and empty input alone", () => {
    expect(shortCwd("/etc/nginx", home)).toBe("/etc/nginx")
    expect(shortCwd("/Users/meta/x", home)).toBe("/Users/meta/x") // not a home prefix match
    expect(shortCwd(undefined, home)).toBe("")
  })
})

describe("sessionSubline", () => {
  const home = "/Users/me"
  it("joins branch and dir when both present", () => {
    expect(sessionSubline("/Users/me/term", home, "main")).toBe("main • ~/term")
  })
  it("shows just the dir or just the branch when the other is missing", () => {
    expect(sessionSubline("/Users/me/term", home)).toBe("~/term")
    expect(sessionSubline(undefined, home, "main")).toBe("main")
  })
})
