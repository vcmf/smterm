import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { FilesPanel } from "./files-panel"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

const st = () => useStore.getState()

describe("FilesPanel", () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it("shows an empty state when the focused pane has no cwd", () => {
    st().newTab(testShell) // session has no cwd yet
    render(<FilesPanel />)
    expect(screen.getByText(/No folder/)).toBeInTheDocument()
  })

  it("lists the root directory returned by readdir", async () => {
    vi.mocked(ipc.readdir).mockResolvedValue({
      entries: [
        { name: "src", isDir: true },
        { name: "README.md", isDir: false },
      ],
      truncated: false,
    })
    st().newTab(testShell)
    const id = allSessionIds(st().tabs[0]!.root)[0]!
    // Unique cwd so the module-level FileTreeCache can't hand back another test's tree.
    st().setSessionCwd(id, "/repo-listtest")
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument())
    expect(screen.getByText("README.md")).toBeInTheDocument()
  })
})
