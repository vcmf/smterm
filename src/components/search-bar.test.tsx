import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { SearchBar } from "./search-bar"
import { useStore } from "../store"
import { resetStore, testShell } from "../test/helpers"
import { TerminalManager } from "../terminal/terminal-manager"

vi.mock("../terminal/terminal-manager", () => ({
  TerminalManager: {
    searchNext: vi.fn(),
    searchPrevious: vi.fn(),
    clearSearch: vi.fn(),
    focus: vi.fn(),
    onSearchResults: vi.fn(() => () => {}),
  },
}))

const focusedId = () => {
  const s = useStore.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)!
  return tab.activeSessionId!
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  useStore.getState().newTab(testShell)
  useStore.getState().setSearchOpen(true)
})

describe("SearchBar", () => {
  it("searches incrementally as you type", () => {
    render(<SearchBar />)
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "foo" } })
    expect(TerminalManager.searchNext).toHaveBeenCalledWith(focusedId(), "foo", false, true)
  })

  it("Enter finds next, Shift+Enter finds previous", () => {
    render(<SearchBar />)
    const input = screen.getByPlaceholderText("Find")
    fireEvent.change(input, { target: { value: "bar" } })
    vi.clearAllMocks() // ignore the incremental call from typing
    fireEvent.keyDown(input, { key: "Enter" })
    expect(TerminalManager.searchNext).toHaveBeenCalledWith(focusedId(), "bar", false)
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(TerminalManager.searchPrevious).toHaveBeenCalledWith(focusedId(), "bar", false)
  })

  it("Escape closes the bar, clears highlights, and refocuses the terminal", () => {
    render(<SearchBar />)
    fireEvent.keyDown(screen.getByPlaceholderText("Find"), { key: "Escape" })
    expect(useStore.getState().searchOpen).toBe(false)
    expect(TerminalManager.clearSearch).toHaveBeenCalledWith(focusedId())
    expect(TerminalManager.focus).toHaveBeenCalledWith(focusedId())
  })

  it("shows the 1-based match count from search results", () => {
    let cb: ((r: { resultIndex: number; resultCount: number }) => void) | undefined
    vi.mocked(TerminalManager.onSearchResults).mockImplementation((_id, c) => {
      cb = c
      return () => {}
    })
    render(<SearchBar />)
    act(() => cb?.({ resultIndex: 2, resultCount: 9 }))
    expect(screen.getByText("3 / 9")).toBeInTheDocument()
  })

  it("toggling match-case re-runs the search case-sensitively", () => {
    render(<SearchBar />)
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "x" } })
    vi.clearAllMocks()
    fireEvent.mouseDown(screen.getByTitle("Match case"))
    expect(TerminalManager.searchNext).toHaveBeenCalledWith(focusedId(), "x", true, true)
  })
})
