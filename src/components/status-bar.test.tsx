import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusBar } from "./status-bar"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("StatusBar", () => {
  it("shows the platform label (from ipc) and UTF-8", async () => {
    render(<StatusBar />)
    expect(await screen.findByText("macOS")).toBeInTheDocument()
    expect(screen.getByText("UTF-8")).toBeInTheDocument()
  })

  it("counts running and waiting sessions", () => {
    st().newTab(testShell)
    const id = allSessionIds(st().tabs[0]!.root)[0]!
    st().signalSession(id, { type: "command-start" }) // → working
    const { container } = render(<StatusBar />)
    expect(container.textContent).toContain("1 running")
    expect(container.textContent).toContain("0 waiting")
  })

  it("shows the git branch when in a repo", () => {
    st().setGit({ isRepo: true, branch: "main", ahead: 0, behind: 0, files: [], add: 0, del: 0 })
    render(<StatusBar />)
    expect(screen.getByText("main")).toBeInTheDocument()
  })

  it("hides the branch when not a repo", () => {
    st().setGit({ isRepo: false, branch: "", ahead: 0, behind: 0, files: [], add: 0, del: 0 })
    const { container } = render(<StatusBar />)
    expect(container.querySelectorAll(".status-item").length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain("main")
  })
})
