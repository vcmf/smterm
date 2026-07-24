import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ContextMenu } from "./context-menu"
import type { MenuItemSpec } from "../lib/file-actions"

const items: MenuItemSpec[] = [
  { id: "preview", label: "Preview" },
  { id: "open", label: "Open in editor", disabled: true, hint: "not found" },
  { id: "reveal", label: "Reveal in Finder", separatorBefore: true },
]

describe("ContextMenu", () => {
  it("renders each item's label + hint", () => {
    render(<ContextMenu x={5} y={5} items={items} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Preview")).toBeInTheDocument()
    expect(screen.getByText("Reveal in Finder")).toBeInTheDocument()
    expect(screen.getByText("not found")).toBeInTheDocument()
  })

  it("selecting an enabled item fires onSelect(id) then onClose", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ContextMenu x={5} y={5} items={items} onSelect={onSelect} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText("Reveal in Finder"))
    expect(onSelect).toHaveBeenCalledWith("reveal")
    expect(onClose).toHaveBeenCalled()
  })

  it("a disabled item does nothing", () => {
    const onSelect = vi.fn()
    render(<ContextMenu x={5} y={5} items={items} onSelect={onSelect} onClose={() => {}} />)
    fireEvent.mouseDown(screen.getByText("Open in editor"))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("Escape closes the menu", () => {
    const onClose = vi.fn()
    render(<ContextMenu x={5} y={5} items={items} onSelect={() => {}} onClose={onClose} />)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(onClose).toHaveBeenCalled()
  })
})
