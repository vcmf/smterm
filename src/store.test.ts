import { describe, it, expect, beforeEach } from "vitest"
import { useStore, isVisibleIn, isSessionVisible } from "./store"
import { allSessionIds } from "./lib/pane-tree"
import { resetStore, testShell as shell } from "./test/helpers"

const st = () => useStore.getState()
const firstTab = () => st().tabs[0]!

describe("store — tabs & panes", () => {
  beforeEach(resetStore)

  it("newTab creates a tab + session and makes it active", () => {
    st().newTab(shell)
    expect(st().tabs).toHaveLength(1)
    expect(Object.keys(st().sessions)).toHaveLength(1)
    expect(st().activeTabId).toBe(firstTab().id)
    expect(firstTab().root.type).toBe("leaf")
  })

  it("splitActive adds a second session to the active tab and focuses it", () => {
    st().newTab(shell)
    st().splitActive("row", shell)
    const tab = firstTab()
    const ids = allSessionIds(tab.root)
    expect(ids).toHaveLength(2)
    expect(tab.root.type).toBe("split")
    expect(ids).toContain(tab.activeSessionId) // newest pane is focused
    expect(Object.keys(st().sessions)).toHaveLength(2)
  })

  it("closePane collapses a split back to a single leaf", () => {
    st().newTab(shell)
    st().splitActive("row", shell)
    const [firstId] = allSessionIds(firstTab().root)
    st().closePane(firstTab().id, firstId!)
    expect(firstTab().root.type).toBe("leaf")
    expect(Object.keys(st().sessions)).toHaveLength(1)
  })

  it("closing the last pane removes the tab, its session, and clears active", () => {
    st().newTab(shell)
    const [only] = allSessionIds(firstTab().root)
    st().closePane(firstTab().id, only!)
    expect(st().tabs).toHaveLength(0)
    expect(Object.keys(st().sessions)).toHaveLength(0)
    expect(st().activeTabId).toBeNull()
  })

  it("closeTab removes the tab and all its sessions", () => {
    st().newTab(shell)
    st().splitActive("column", shell)
    st().closeTab(firstTab().id)
    expect(st().tabs).toHaveLength(0)
    expect(Object.keys(st().sessions)).toHaveLength(0)
  })

  it("closeTab picks a surviving tab as active", () => {
    st().newTab(shell)
    const firstId = firstTab().id
    st().newTab(shell)
    st().setActiveTab(firstId)
    st().closeTab(firstId)
    expect(st().tabs).toHaveLength(1)
    expect(st().activeTabId).toBe(st().tabs[0]!.id)
  })

  it("renameTab updates the title", () => {
    st().newTab(shell)
    st().renameTab(firstTab().id, "build")
    expect(firstTab().title).toBe("build")
  })

  it("setActivePane changes the tab's focused session", () => {
    st().newTab(shell)
    st().splitActive("row", shell)
    const ids = allSessionIds(firstTab().root)
    st().setActivePane(firstTab().id, ids[0]!)
    expect(firstTab().activeSessionId).toBe(ids[0])
  })
})

describe("store — status signals & visibility", () => {
  beforeEach(resetStore)

  const setup = () => {
    st().newTab(shell)
    return allSessionIds(firstTab().root)[0]!
  }

  it("command-start → working, command-end → idle", () => {
    const id = setup()
    st().signalSession(id, { type: "command-start" })
    expect(st().sessions[id]!.status).toBe("working")
    st().signalSession(id, { type: "command-end" })
    expect(st().sessions[id]!.status).toBe("idle")
  })

  it("attention on a hidden session sets attention + unread", () => {
    const id = setup()
    useStore.setState({ windowFocused: false }) // session no longer visible
    st().signalSession(id, { type: "attention" })
    expect(st().sessions[id]!.status).toBe("attention")
    expect(st().sessions[id]!.unread).toBe(true)
  })

  it("output-idle flips a working session to attention", () => {
    const id = setup()
    st().signalSession(id, { type: "command-start" })
    st().signalSession(id, { type: "output-idle" })
    expect(st().sessions[id]!.status).toBe("attention")
  })

  it("revealTab clears unread and downgrades attention to idle", () => {
    const id = setup()
    useStore.setState({ windowFocused: false })
    st().signalSession(id, { type: "attention" })
    st().revealTab(firstTab().id)
    expect(st().sessions[id]!.status).toBe("idle")
    expect(st().sessions[id]!.unread).toBe(false)
  })

  it("setWindowFocused(true) reveals the active tab", () => {
    const id = setup()
    useStore.setState({ windowFocused: false })
    st().signalSession(id, { type: "attention" })
    st().setWindowFocused(true)
    expect(st().sessions[id]!.unread).toBe(false)
  })

  it("isVisibleIn / isSessionVisible reflect focus + active tab", () => {
    const id = setup()
    expect(isSessionVisible(id)).toBe(true)
    useStore.setState({ windowFocused: false })
    expect(isSessionVisible(id)).toBe(false)
    useStore.setState({ windowFocused: true, activeTabId: null })
    expect(isVisibleIn(st(), id)).toBe(false)
  })
})

describe("store — cwd & UI toggles", () => {
  beforeEach(resetStore)

  it("setSessionCwd records a session's directory", () => {
    st().newTab(shell)
    const id = allSessionIds(firstTab().root)[0]!
    st().setSessionCwd(id, "/home/u/proj")
    expect(st().sessions[id]!.cwd).toBe("/home/u/proj")
  })

  it("setSessionCwd ignores unknown sessions", () => {
    st().setSessionCwd("nope", "/x")
    expect(st().sessions.nope).toBeUndefined()
  })

  it("toggles paletteOpen / settingsOpen / diffPanelOpen", () => {
    st().setPaletteOpen(true)
    st().setSettingsOpen(true)
    st().setDiffPanelOpen(true)
    expect(st().paletteOpen).toBe(true)
    expect(st().settingsOpen).toBe(true)
    expect(st().diffPanelOpen).toBe(true)
  })

  it("setGit stores the latest git status", () => {
    st().setGit({ isRepo: true, branch: "main", ahead: 1, behind: 0, files: [], add: 0, del: 0 })
    expect(st().git?.branch).toBe("main")
  })

  it("splitActive inherits the source pane's cwd", () => {
    st().newTab(shell)
    const src = allSessionIds(firstTab().root)[0]!
    st().setSessionCwd(src, "/proj/a")
    st().splitActive("row", shell)
    const other = allSessionIds(firstTab().root).find((id) => id !== src)!
    expect(st().sessions[other]!.cwd).toBe("/proj/a")
  })

  it("newTab inherits the focused terminal's cwd", () => {
    st().newTab(shell)
    const first = allSessionIds(firstTab().root)[0]!
    st().setSessionCwd(first, "/proj/b")
    st().newTab(shell) // focus is still the first tab's session at call time
    const newSession = allSessionIds(st().tabs[1]!.root)[0]!
    expect(st().sessions[newSession]!.cwd).toBe("/proj/b")
  })

  it("restoreWorkspace replaces sessions/tabs/activeTabId", () => {
    st().restoreWorkspace({
      sessions: {
        x: { id: "x", title: "t", command: "/bin/zsh", args: [], status: "idle", unread: false },
      },
      tabs: [
        { id: "tb", title: "t", root: { type: "leaf", sessionId: "x" }, activeSessionId: "x" },
      ],
      activeTabId: "tb",
    })
    expect(st().tabs).toHaveLength(1)
    expect(st().activeTabId).toBe("tb")
    expect(st().sessions.x).toBeDefined()
  })
})
