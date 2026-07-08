import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TerminalPane } from "./terminal-pane"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

vi.mock("../terminal/terminal-manager", () => ({
  TerminalManager: { attach: vi.fn(), fit: vi.fn(), focus: vi.fn(), dispose: vi.fn() },
}))

const st = () => useStore.getState()

const mountPane = () => {
  st().newTab(testShell)
  const tab = st().tabs[0]!
  const id = allSessionIds(tab.root)[0]!
  return { tabId: tab.id, id }
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("TerminalPane", () => {
  it("renders the pane header (cwd-basename title + shell-type badge)", () => {
    const { tabId, id } = mountPane()
    st().setSessionCwd(id, "/w/proj")
    render(<TerminalPane sessionId={id} tabId={tabId} />)
    expect(screen.getByText("proj")).toBeInTheDocument() // title = cwd basename
    expect(screen.getByText("sh")).toBeInTheDocument() // badge = shell type
  })

  it("the split-right button splits this pane", () => {
    const { tabId, id } = mountPane()
    render(<TerminalPane sessionId={id} tabId={tabId} />)
    fireEvent.mouseDown(screen.getByTitle("Split right"))
    expect(allSessionIds(st().tabs[0]!.root)).toHaveLength(2)
  })

  it("the split-down button splits vertically", () => {
    const { tabId, id } = mountPane()
    render(<TerminalPane sessionId={id} tabId={tabId} />)
    fireEvent.mouseDown(screen.getByTitle("Split down"))
    expect(st().tabs[0]!.root.type).toBe("split")
  })

  it("the close button closes the pane (last pane → tab removed)", () => {
    const { tabId, id } = mountPane()
    render(<TerminalPane sessionId={id} tabId={tabId} />)
    fireEvent.mouseDown(screen.getByTitle("Close pane"))
    expect(st().tabs).toHaveLength(0)
  })
})
