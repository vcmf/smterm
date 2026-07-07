import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CommandPalette } from "./command-palette"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("CommandPalette", () => {
  it("renders grouped commands", () => {
    st().newTab(testShell)
    render(<CommandPalette />)
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.getByText("Appearance")).toBeInTheDocument()
    expect(screen.getAllByText("New session").length).toBeGreaterThan(0)
    expect(screen.getByText("Split pane right")).toBeInTheDocument()
  })

  it("filters by query", () => {
    st().newTab(testShell)
    render(<CommandPalette />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "theme" } })
    expect(screen.queryByText("Split pane right")).not.toBeInTheDocument()
    expect(screen.getAllByText("Theme").length).toBeGreaterThan(0)
  })

  it("Enter runs the selected command (new session adds a tab)", () => {
    render(<CommandPalette />)
    const before = st().tabs.length
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(st().tabs.length).toBe(before + 1)
  })

  it("arrow-down + Enter runs a split", () => {
    st().newTab(testShell)
    render(<CommandPalette />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "split pane right" } })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(allSessionIds(st().tabs[0]!.root)).toHaveLength(2)
  })

  it("Escape closes the palette", () => {
    st().setPaletteOpen(true)
    render(<CommandPalette />)
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
    expect(st().paletteOpen).toBe(false)
  })

  it("shows an empty state when nothing matches", () => {
    render(<CommandPalette />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzznope" } })
    expect(screen.getByText(/No matching commands/i)).toBeInTheDocument()
  })
})
