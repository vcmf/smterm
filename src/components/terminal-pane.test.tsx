import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TerminalPane } from "./terminal-pane"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"
import type { PaneLeaf } from "../types"

vi.mock("../terminal/terminal-manager", () => ({
  TerminalManager: {
    attach: vi.fn(),
    detach: vi.fn(),
    ensureRunning: vi.fn(),
    followSize: vi.fn(),
    fit: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  },
}))

const st = () => useStore.getState()

const mountPane = () => {
  st().newTab(testShell)
  const tab = st().tabs[0]!
  const id = allSessionIds(tab.root)[0]!
  return { tabId: tab.id, id }
}

/** The (single) pane of the first tab, as currently stored. */
const leaf = () => st().tabs[0]!.root as PaneLeaf

/** Render the first tab's pane, re-rendering on store changes like PaneLayout would. */
const renderPane = (tabId: string) => {
  const view = render(<TerminalPane pane={leaf()} tabId={tabId} />)
  const rerender = () => view.rerender(<TerminalPane pane={leaf()} tabId={tabId} />)
  return { ...view, rerender }
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("TerminalPane", () => {
  it("renders the pane header (cwd-basename title + shell-type badge)", () => {
    const { tabId, id } = mountPane()
    st().setSessionCwd(id, "/w/proj")
    renderPane(tabId)
    expect(screen.getByText("proj")).toBeInTheDocument() // title = cwd basename
    expect(screen.getByText("sh")).toBeInTheDocument() // badge = shell type
  })

  it("the split-right button splits this pane", () => {
    const { tabId } = mountPane()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle("Split right"))
    expect(allSessionIds(st().tabs[0]!.root)).toHaveLength(2)
  })

  it("the split-down button splits vertically", () => {
    const { tabId } = mountPane()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle("Split down"))
    expect(st().tabs[0]!.root.type).toBe("split")
  })

  it("the close button closes a single-terminal pane (last pane → tab removed)", () => {
    const { tabId } = mountPane()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle("Close pane"))
    expect(st().tabs).toHaveLength(0)
  })

  it("a single terminal shows no per-surface close button", () => {
    const { tabId } = mountPane()
    renderPane(tabId)
    expect(screen.queryByTitle("Close terminal")).not.toBeInTheDocument()
  })
})

describe("TerminalPane — surfaces", () => {
  it("the new-terminal button adds a surface tab to this pane", () => {
    const { tabId } = mountPane()
    const view = renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle(/New terminal/))
    expect(leaf().sessionIds).toHaveLength(2)
    view.rerender()
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(screen.getAllByTitle("Close terminal")).toHaveLength(2)
  })

  it("clicking a surface tab makes it visible + focused", () => {
    const { tabId, id: first } = mountPane()
    st().newSurface()
    const view = renderPane(tabId)
    fireEvent.mouseDown(screen.getAllByRole("tab")[0]!)
    expect(leaf().activeSessionId).toBe(first)
    expect(st().tabs[0]!.activeSessionId).toBe(first)
    view.rerender()
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true")
  })

  it("closing a surface tab closes just that terminal", () => {
    const { tabId, id: first } = mountPane()
    st().newSurface()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getAllByTitle("Close terminal")[1]!)
    expect(leaf().sessionIds).toEqual([first])
  })

  it("closing a multi-terminal pane asks for confirmation instead of closing", () => {
    const { tabId } = mountPane()
    st().newSurface()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle("Close pane"))
    expect(st().closePaneConfirm).toMatchObject({ count: 2 })
    expect(leaf().sessionIds).toHaveLength(2)
  })

  it("switching the visible surface re-attaches: detach old, attach new", async () => {
    const { TerminalManager } = await import("../terminal/terminal-manager")
    const { tabId, id: first } = mountPane()
    st().newSurface()
    const second = leaf().activeSessionId
    const view = renderPane(tabId)
    expect(TerminalManager.attach).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: second }),
      expect.any(HTMLElement),
    )
    st().setActivePane(tabId, first)
    view.rerender()
    expect(TerminalManager.detach).toHaveBeenCalledWith(second, expect.any(HTMLElement))
    expect(TerminalManager.attach).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: first }),
      expect.any(HTMLElement),
    )
  })
})

describe("TerminalPane — hidden surfaces keep running", () => {
  it("starts every hidden surface off-screen, sized like the visible one", async () => {
    const { TerminalManager } = await import("../terminal/terminal-manager")
    const { tabId, id: first } = mountPane()
    st().newSurface()
    const visible = leaf().activeSessionId
    renderPane(tabId)
    expect(TerminalManager.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ id: first }),
      visible,
    )
    expect(TerminalManager.ensureRunning).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: visible }),
      expect.anything(),
    )
  })

  it("right-clicking a surface tab opens no clipboard menu (it'd target another surface)", () => {
    const { tabId } = mountPane()
    st().newSurface()
    renderPane(tabId)
    fireEvent.contextMenu(screen.getAllByRole("tab")[0]!)
    expect(screen.queryByText("Paste")).not.toBeInTheDocument()
  })

  it("only a left-click on a surface's close button closes it", () => {
    const { tabId } = mountPane()
    st().newSurface()
    renderPane(tabId)
    const close = screen.getAllByTitle("Close terminal")[0]!
    fireEvent.mouseDown(close, { button: 2 })
    fireEvent.mouseDown(close, { button: 1 })
    expect(leaf().sessionIds).toHaveLength(2)
    fireEvent.mouseDown(close, { button: 0 })
    expect(leaf().sessionIds).toHaveLength(1)
  })

  it("only a left-click on the new-terminal button adds a surface", () => {
    const { tabId } = mountPane()
    renderPane(tabId)
    fireEvent.mouseDown(screen.getByTitle(/New terminal/), { button: 2 })
    expect(leaf().sessionIds).toHaveLength(1)
    fireEvent.mouseDown(screen.getByTitle(/New terminal/), { button: 0 })
    expect(leaf().sessionIds).toHaveLength(2)
  })
})
