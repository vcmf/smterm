import { describe, it, expect, beforeEach } from "vitest"
import { useStore } from "./store"
import { allSessionIds } from "./lib/pane-tree"
import type { ShellOption } from "./types"

const shell: ShellOption = { id: "sh", label: "sh", command: "/bin/sh", args: [] }

const reset = () => useStore.setState({ sessions: {}, tabs: [], activeTabId: null, shells: [] })

describe("store", () => {
  beforeEach(reset)

  it("newTab creates a tab + session and makes it active", () => {
    useStore.getState().newTab(shell)
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(Object.keys(s.sessions)).toHaveLength(1)
    expect(s.activeTabId).toBe(s.tabs[0]!.id)
    expect(s.tabs[0]!.root.type).toBe("leaf")
  })

  it("splitActive adds a second session to the active tab", () => {
    useStore.getState().newTab(shell)
    useStore.getState().splitActive("row", shell)
    const tab = useStore.getState().tabs[0]!
    expect(allSessionIds(tab.root)).toHaveLength(2)
    expect(tab.root.type).toBe("split")
    expect(Object.keys(useStore.getState().sessions)).toHaveLength(2)
  })

  it("closePane collapses a split back to a single leaf", () => {
    useStore.getState().newTab(shell)
    useStore.getState().splitActive("row", shell)
    const tab = useStore.getState().tabs[0]!
    const [firstId] = allSessionIds(tab.root)
    useStore.getState().closePane(tab.id, firstId!)
    const after = useStore.getState().tabs[0]!
    expect(after.root.type).toBe("leaf")
    expect(Object.keys(useStore.getState().sessions)).toHaveLength(1)
  })

  it("closing the last pane removes the tab and its session", () => {
    useStore.getState().newTab(shell)
    const tab = useStore.getState().tabs[0]!
    const [only] = allSessionIds(tab.root)
    useStore.getState().closePane(tab.id, only!)
    expect(useStore.getState().tabs).toHaveLength(0)
    expect(Object.keys(useStore.getState().sessions)).toHaveLength(0)
    expect(useStore.getState().activeTabId).toBeNull()
  })

  it("closeTab removes the tab and all its sessions", () => {
    useStore.getState().newTab(shell)
    useStore.getState().splitActive("column", shell)
    const tab = useStore.getState().tabs[0]!
    useStore.getState().closeTab(tab.id)
    expect(useStore.getState().tabs).toHaveLength(0)
    expect(Object.keys(useStore.getState().sessions)).toHaveLength(0)
  })
})
