import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TopBar } from "./top-bar"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("TopBar", () => {
  it("renders the brand and open tabs", () => {
    st().newTab(testShell)
    st().renameTab(st().tabs[0]!.id, "build")
    render(<TopBar />)
    expect(screen.getByText("smterm")).toBeInTheDocument()
    expect(screen.getByText("build")).toBeInTheDocument()
  })

  it("the search pill opens the command palette", () => {
    render(<TopBar />)
    fireEvent.click(screen.getByText("Search or run"))
    expect(st().paletteOpen).toBe(true)
  })

  it("the + button opens a new tab", () => {
    render(<TopBar />)
    const before = st().tabs.length
    fireEvent.click(screen.getByTitle("New tab"))
    expect(st().tabs.length).toBe(before + 1)
  })

  it("window controls call the ipc seam", () => {
    render(<TopBar />)
    fireEvent.click(screen.getByTitle("Minimize"))
    fireEvent.click(screen.getByTitle("Maximize"))
    fireEvent.click(screen.getByTitle("Close"))
    expect(ipc.minimizeWindow).toHaveBeenCalledOnce()
    expect(ipc.maximizeWindow).toHaveBeenCalledOnce()
    expect(ipc.closeWindow).toHaveBeenCalledOnce()
  })

  it("toggles the diff panel", () => {
    render(<TopBar />)
    fireEvent.click(screen.getByTitle("Toggle changes panel"))
    expect(st().diffPanelOpen).toBe(true)
  })

  it("the bell shows a waiting count and jumps to that session", () => {
    st().newTab(testShell)
    st().newTab(testShell)
    const waitingTab = st().tabs[0]!
    const waitingSession = allSessionIds(waitingTab.root)[0]!
    useStore.setState({ windowFocused: false })
    st().signalSession(waitingSession, { type: "attention" })
    useStore.setState({ activeTabId: st().tabs[1]!.id }) // focus the other tab
    render(<TopBar />)
    expect(screen.getByText("1")).toBeInTheDocument() // bell count
    fireEvent.click(screen.getByTitle(/waiting — jump/))
    expect(st().activeTabId).toBe(waitingTab.id)
  })

  it("the shell menu opens and spawns a chosen shell", () => {
    useStore.setState({
      shells: [testShell, { id: "bash", label: "bash", command: "/bin/bash", args: [] }],
    })
    const { container } = render(<TopBar />)
    fireEvent.click(screen.getByTitle("New tab in…"))
    expect(container.querySelector(".shell-menu")).toBeTruthy()
    const before = st().tabs.length
    fireEvent.mouseDown(screen.getByText("bash")) // menu item
    expect(st().tabs.length).toBe(before + 1)
    expect(container.querySelector(".shell-menu")).toBeFalsy() // menu closed
  })
})
