import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Sidebar } from "./sidebar"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

vi.mock("../terminal/terminal-manager", () => ({
  TerminalManager: { attach: vi.fn(), fit: vi.fn(), focus: vi.fn(), dispose: vi.fn() },
}))

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("Sidebar", () => {
  it("renders the header, legend, and session tree", () => {
    st().newTab(testShell)
    st().renameTab(st().tabs[0]!.id, "work")
    render(<Sidebar />)
    expect(screen.getByText("Sessions & agents")).toBeInTheDocument()
    expect(screen.getByText("work")).toBeInTheDocument() // session (tab) row
    expect(screen.getByText("1 pane")).toBeInTheDocument()
    expect(screen.getByText("running")).toBeInTheDocument()
    expect(screen.getByText("needs input")).toBeInTheDocument()
  })

  it("shows a pane row per session with its status word", () => {
    st().newTab(testShell)
    render(<Sidebar />)
    // "idle" appears both as the pane meta and the legend
    expect(screen.getAllByText("idle").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("/bin/sh")).toBeInTheDocument()
  })

  it("clicking a pane row focuses that session", () => {
    st().newTab(testShell)
    st().renameTab(st().tabs[0]!.id, "work")
    st().splitActive("row", testShell)
    const ids = allSessionIds(st().tabs[0]!.root)
    render(<Sidebar />)
    const paneRows = screen.getAllByText("sh") // both pane primaries
    fireEvent.mouseDown(paneRows[0]!)
    expect(st().tabs[0]!.activeSessionId).toBe(ids[0])
  })
})
