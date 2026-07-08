import { describe, it, expect } from "vitest"
import {
  tabTitle,
  shortCwd,
  cwdBasename,
  shellType,
  isCustomOscTitle,
  displaySessionTitle,
  sessionSubline,
} from "./session-label"
import type { Session, Tab } from "../types"

const home = "/Users/me"

const mk = (over: Partial<Session> = {}): Session => ({
  id: "s",
  title: "zsh",
  command: "/bin/zsh",
  args: [],
  status: "idle",
  unread: false,
  ...over,
})
const tab = (title: string, activeSessionId = "s"): Tab => ({
  id: "t",
  title,
  root: { type: "leaf", sessionId: activeSessionId },
  activeSessionId,
})

describe("shellType", () => {
  it("derives a short badge label from the command", () => {
    expect(shellType("/bin/zsh")).toBe("zsh")
    expect(shellType("/usr/bin/bash")).toBe("bash")
    expect(shellType("powershell.exe")).toBe("pwsh")
    expect(shellType("C:\\Windows\\System32\\cmd.exe")).toBe("cmd")
    expect(shellType("wsl.exe")).toBe("wsl")
    expect(shellType("")).toBe("shell")
  })
})

describe("cwdBasename", () => {
  it("returns the last segment, ~ for home, empty for none", () => {
    expect(cwdBasename("/Users/me/src/term", home)).toBe("term")
    expect(cwdBasename("/Users/me", home)).toBe("~")
    expect(cwdBasename(undefined, home)).toBe("")
  })
})

describe("isCustomOscTitle", () => {
  it("rejects shell-default noise, accepts real titles", () => {
    expect(isCustomOscTitle("haquangle@Has-MacBook-Pro:~/workspace/term")).toBe(false)
    expect(isCustomOscTitle("~/workspace/term")).toBe(false)
    expect(isCustomOscTitle("src/auth/session.ts")).toBe(false)
    expect(isCustomOscTitle("Explore hexgate repos")).toBe(true)
    expect(isCustomOscTitle("")).toBe(false)
    expect(isCustomOscTitle(undefined)).toBe(false)
  })
})

describe("displaySessionTitle", () => {
  it("prefers a custom program title", () => {
    expect(displaySessionTitle(mk({ oscTitle: "Explore hexgate", cwd: "/Users/me/x" }), home)).toBe(
      "Explore hexgate",
    )
  })
  it("ignores noisy OSC titles and uses the cwd basename", () => {
    expect(displaySessionTitle(mk({ oscTitle: "me@host:~/x", cwd: "/Users/me/term" }), home)).toBe(
      "term",
    )
  })
  it("falls back to shell type when there's no cwd", () => {
    expect(displaySessionTitle(mk({ command: "/bin/bash" }), home)).toBe("bash")
  })
})

describe("tabTitle", () => {
  it("uses the manual pin when set, else the focused pane's display title", () => {
    expect(tabTitle(tab("Build"), { s: mk({ cwd: "/Users/me/term" }) }, home)).toBe("Build")
    expect(tabTitle(tab(""), { s: mk({ cwd: "/Users/me/term" }) }, home)).toBe("term")
  })
})

describe("shortCwd / sessionSubline", () => {
  it("home-relative cwd", () => {
    expect(shortCwd("/Users/me/term", home)).toBe("~/term")
    expect(shortCwd("/etc", home)).toBe("/etc")
  })
  it("joins branch and dir", () => {
    expect(sessionSubline("/Users/me/term", home, "main")).toBe("main • ~/term")
    expect(sessionSubline(undefined, home, "main")).toBe("main")
  })
})
