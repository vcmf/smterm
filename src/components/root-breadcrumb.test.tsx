import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RootBreadcrumb } from "./root-breadcrumb"
import { useStore } from "../store"
import { resetStore } from "../test/helpers"

describe("RootBreadcrumb", () => {
  beforeEach(resetStore)

  it("renders the trailing path segments as crumbs", () => {
    render(<RootBreadcrumb root="/a/b/c" cwd="/a/b/c" sessionId="s" diverged={false} />)
    expect(screen.getByText("c")).toBeInTheDocument()
    expect(screen.getByText("b")).toBeInTheDocument()
  })

  it("clicking a crumb sets that ancestor as the root", () => {
    const spy = vi.fn()
    useStore.setState({ setPaneRoot: spy })
    render(<RootBreadcrumb root="/a/b/c" cwd="/a/b/c" sessionId="s" diverged={false} />)
    fireEvent.click(screen.getByText("b"))
    expect(spy).toHaveBeenCalledWith("s", "/a/b")
  })

  it("shows an amber reset only when diverged, and it clears the override", () => {
    const spy = vi.fn()
    useStore.setState({ clearPaneRoot: spy })
    const { rerender } = render(
      <RootBreadcrumb root="/a/b" cwd="/a/b" sessionId="s" diverged={false} />,
    )
    expect(screen.queryByTitle(/Reset to terminal folder/)).toBeNull()
    rerender(<RootBreadcrumb root="/a/b" cwd="/x" sessionId="s" diverged={true} />)
    fireEvent.click(screen.getByTitle(/Reset to terminal folder/))
    expect(spy).toHaveBeenCalledWith("s")
  })

  it("the edit button reveals a path input", () => {
    render(<RootBreadcrumb root="/a/b" cwd="/a/b" sessionId="s" diverged={false} />)
    fireEvent.click(screen.getByTitle("Enter a path"))
    expect(screen.getByPlaceholderText(/folder path/i)).toBeInTheDocument()
  })
})
