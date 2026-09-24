import { describe, it, expect } from "vitest"
import {
  serializeWorkspace,
  deserializeWorkspace,
  migratePaneNode,
  parseWorkspace,
  readWorkspaceFile,
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
  root: { type: "leaf", id: "p1", sessionIds: ["s1"], activeSessionId: "s1" },
  activeSessionId: "s1",
}
const state: WorkspaceState = { sessions: { s1: session }, tabs: [tab], activeTabId: "t1" }

describe("workspace serialize/deserialize", () => {
  it("serialize drops runtime status/unread but keeps layout + spawn info", () => {
    const w = serializeWorkspace(state)
    expect(w.version).toBe(2)
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

describe("workspace v1 → v2 pane migration", () => {
  const v1 = {
    version: 1,
    activeTabId: "t1",
    tabs: [
      {
        id: "t1",
        title: "",
        root: {
          type: "split",
          id: "sp",
          direction: "row",
          children: [
            { type: "leaf", sessionId: "a" },
            { type: "leaf", sessionId: "b" },
          ],
        },
        activeSessionId: "b",
      },
    ],
    sessions: [
      { id: "a", title: "zsh", command: "/bin/zsh", args: [] },
      { id: "b", title: "zsh", command: "/bin/zsh", args: [] },
    ],
  }

  it("turns each v1 leaf into a single-surface pane with a deterministic id", () => {
    const restored = deserializeWorkspace(v1)!
    const root = restored.tabs[0]!.root
    expect(root).toEqual({
      type: "split",
      id: "sp",
      direction: "row",
      children: [
        { type: "leaf", id: "pane-a", sessionIds: ["a"], activeSessionId: "a" },
        { type: "leaf", id: "pane-b", sessionIds: ["b"], activeSessionId: "b" },
      ],
    })
    expect(restored.tabs[0]!.activeSessionId).toBe("b")
  })

  it("round-trips a multi-surface pane, keeping the visible surface", () => {
    const multi: WorkspaceState = {
      sessions: { s1: session, s2: { ...session, id: "s2" } },
      tabs: [
        {
          id: "t1",
          title: "",
          root: { type: "leaf", id: "p1", sessionIds: ["s1", "s2"], activeSessionId: "s2" },
          activeSessionId: "s2",
        },
      ],
      activeTabId: "t1",
    }
    const restored = parseWorkspace(serializeToJson(multi))!
    expect(restored.tabs[0]!.root).toEqual(multi.tabs[0]!.root)
  })

  it("repairs a focused session that isn't in the tab (falls back to the first pane)", () => {
    const restored = deserializeWorkspace({
      ...v1,
      tabs: [{ ...v1.tabs[0]!, activeSessionId: "gone" }],
    })!
    expect(restored.tabs[0]!.activeSessionId).toBe("a")
  })

  it("focusing a hidden surface on restore makes it the pane's visible one", () => {
    const restored = deserializeWorkspace({
      version: 2,
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          title: "",
          root: { type: "leaf", id: "p", sessionIds: ["a", "b"], activeSessionId: "b" },
          activeSessionId: "a",
        },
      ],
      sessions: v1.sessions,
    })!
    expect(restored.tabs[0]!.root).toMatchObject({ activeSessionId: "a" })
  })

  it("migratePaneNode rejects malformed nodes", () => {
    expect(migratePaneNode(null)).toBeNull()
    expect(migratePaneNode({ type: "leaf" })).toBeNull()
    expect(migratePaneNode({ type: "leaf", id: "p", sessionIds: [] })).toBeUndefined() // drops out
    expect(migratePaneNode({ type: "split", id: "s", direction: "row", children: [] })).toBeNull()
    expect(
      migratePaneNode({
        type: "split",
        id: "s",
        direction: "diagonal",
        children: [
          { type: "leaf", sessionId: "a" },
          { type: "leaf", sessionId: "b" },
        ],
      }),
    ).toBeNull()
  })

  it("migratePaneNode repairs a v2 leaf whose active surface is missing", () => {
    expect(
      migratePaneNode({ type: "leaf", id: "p", sessionIds: ["a", "b"], activeSessionId: "zz" }),
    ).toMatchObject({ activeSessionId: "a" })
  })

  it("rejects a workspace written by a newer build instead of misparsing it", () => {
    expect(deserializeWorkspace({ ...v1, version: 3 })).toBeNull()
  })

  it("writes a legacy `sessionId` (the visible surface) on each leaf for older builds", () => {
    const w = serializeWorkspace({
      sessions: { s1: session, s2: { ...session, id: "s2" } },
      tabs: [
        {
          id: "t1",
          title: "",
          root: { type: "leaf", id: "p1", sessionIds: ["s1", "s2"], activeSessionId: "s2" },
          activeSessionId: "s2",
        },
      ],
      activeTabId: "t1",
    })
    expect(w.tabs[0]!.root).toMatchObject({ sessionId: "s2", sessionIds: ["s1", "s2"] })
    // …and the v2 reader ignores the mirror (sessionIds wins)
    expect(deserializeWorkspace(w)!.tabs[0]!.root).toEqual({
      type: "leaf",
      id: "p1",
      sessionIds: ["s1", "s2"],
      activeSessionId: "s2",
    })
  })

  it("drops a session placed in two panes (keeps the first) and collapses the emptied pane", () => {
    const restored = deserializeWorkspace({
      ...v1,
      tabs: [
        {
          ...v1.tabs[0]!,
          root: {
            type: "split",
            id: "sp",
            direction: "row",
            children: [
              { type: "leaf", id: "p1", sessionIds: ["a", "a", "b"], activeSessionId: "a" },
              { type: "leaf", id: "p2", sessionIds: ["b"], activeSessionId: "b" },
            ],
          },
        },
      ],
    })!
    expect(restored.tabs[0]!.root).toEqual({
      type: "leaf",
      id: "p1",
      sessionIds: ["a", "b"],
      activeSessionId: "b", // the tab's focus (b) is made visible on restore
    })
  })

  it("prunes sessions no pane references", () => {
    const restored = deserializeWorkspace({
      ...v1,
      sessions: [...v1.sessions, { id: "orphan", title: "zsh", command: "/bin/zsh", args: [] }],
    })!
    expect(restored.sessions.orphan).toBeUndefined()
    expect(restored.pruned).toEqual(["orphan"]) // so the app can kill a reloaded PTY
    expect(Object.keys(restored.sessions).sort()).toEqual(["a", "b"])
  })

  it("readWorkspaceFile flags a newer build's file (so the app won't overwrite it)", () => {
    const newer = readWorkspaceFile(JSON.stringify({ ...v1, version: 3 }))
    expect(newer).toEqual({ state: null, newer: true })
    expect(readWorkspaceFile(JSON.stringify(v1)).newer).toBe(false)
    expect(readWorkspaceFile("nope")).toEqual({ state: null, newer: false })
  })

  it("drops surfaces with no session record; an emptied pane collapses (layout kept)", () => {
    const restored = deserializeWorkspace({
      ...v1,
      tabs: [
        {
          ...v1.tabs[0]!,
          root: {
            type: "split",
            id: "sp",
            direction: "row",
            children: [
              { type: "leaf", id: "p1", sessionIds: ["a", "ghost"], activeSessionId: "ghost" },
              { type: "leaf", id: "p2", sessionIds: [], activeSessionId: "x" },
            ],
          },
          activeSessionId: "a",
        },
      ],
    })!
    expect(restored.tabs[0]!.root).toEqual({
      type: "leaf",
      id: "p1",
      sessionIds: ["a"],
      activeSessionId: "a",
    })
  })

  it("renames a duplicated pane id so closing one pane can't close the other", () => {
    const restored = deserializeWorkspace({
      ...v1,
      tabs: [
        {
          ...v1.tabs[0]!,
          root: {
            type: "split",
            id: "sp",
            direction: "row",
            children: [
              { type: "leaf", id: "dup", sessionIds: ["a"], activeSessionId: "a" },
              { type: "leaf", id: "dup", sessionIds: ["b"], activeSessionId: "b" },
            ],
          },
        },
      ],
    })!
    const root = restored.tabs[0]!.root
    if (root.type !== "split") throw new Error("expected split")
    expect(root.children.map((c) => c.id)).toEqual(["dup", "pane-b"])
  })
})
