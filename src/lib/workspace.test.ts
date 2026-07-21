import { describe, it, expect } from "vitest"
import {
  serializeWorkspace,
  deserializeWorkspace,
  parseWorkspace,
  serializeToJson,
} from "./workspace"
import type { WorkspaceState } from "./workspace"
import type { Session, Tab } from "../types"

const session: Session = {
  id: "s1",
  title: "zsh",
  command: "/bin/zsh",
  args: ["-l"],
  status: "working", // runtime — must NOT be persisted
  unread: true,
  cwd: "/proj",
}
const tab: Tab = {
  id: "t1",
  title: "zsh",
  root: { type: "leaf", sessionId: "s1" },
  activeSessionId: "s1",
}
const state: WorkspaceState = { sessions: { s1: session }, tabs: [tab], activeTabId: "t1" }

describe("workspace serialize/deserialize", () => {
  it("serialize drops runtime status/unread but keeps layout + spawn info", () => {
    const w = serializeWorkspace(state)
    expect(w.version).toBe(1)
    expect(w.activeTabId).toBe("t1")
    expect(w.sessions[0]).toEqual({
      id: "s1",
      title: "zsh",
      command: "/bin/zsh",
      args: ["-l"],
      cwd: "/proj",
    })
    expect(w.sessions[0]).not.toHaveProperty("status")
  })

  it("round-trips through JSON, resetting status to idle", () => {
    const restored = parseWorkspace(serializeToJson(state))!
    expect(restored.tabs).toHaveLength(1)
    expect(restored.activeTabId).toBe("t1")
    expect(restored.sessions.s1).toMatchObject({
      command: "/bin/zsh",
      cwd: "/proj",
      status: "idle",
      unread: false,
    })
  })

  it("falls back activeTabId to the first tab when stale", () => {
    const restored = deserializeWorkspace({ ...serializeWorkspace(state), activeTabId: "gone" })!
    expect(restored.activeTabId).toBe("t1")
  })

  it("round-trips rightPanelWidth (clamped), and omits it when unset", () => {
    const withWidth = parseWorkspace(serializeToJson({ ...state, rightPanelWidth: 500 }))!
    expect(withWidth.rightPanelWidth).toBe(500)
    // clamped on restore (a bad persisted value can't set an absurd width)
    const clamped = deserializeWorkspace({ ...serializeWorkspace(state), rightPanelWidth: 5000 })!
    expect(clamped.rightPanelWidth).toBe(760)
    // absent → undefined (restore keeps the store default)
    expect(serializeWorkspace(state)).not.toHaveProperty("rightPanelWidth")
    expect(parseWorkspace(serializeToJson(state))!.rightPanelWidth).toBeUndefined()
  })

  it("rejects malformed / empty input", () => {
    expect(deserializeWorkspace(null)).toBeNull()
    expect(deserializeWorkspace({})).toBeNull()
    expect(deserializeWorkspace({ tabs: [], sessions: [] })).toBeNull()
    expect(deserializeWorkspace({ tabs: [{ id: "t" }], sessions: [] })).toBeNull() // tab w/o root
    expect(parseWorkspace("")).toBeNull()
    expect(parseWorkspace("not json")).toBeNull()
  })
})
