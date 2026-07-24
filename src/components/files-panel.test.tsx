import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { FilesPanel } from "./files-panel"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"
import type { ShellOption } from "../types"
import { fireEvent } from "@testing-library/react"

const st = () => useStore.getState()
const wslShell: ShellOption = {
  id: "wsl",
  label: "WSL",
  command: "wsl.exe",
  args: ["-d", "Ubuntu"],
}

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

  it("clicking a file on a WSL pane opens the preview with the pane's WSL context", async () => {
    vi.mocked(ipc.readdir).mockResolvedValue({
      entries: [{ name: "app.ts", isDir: false }],
      truncated: false,
    })
    st().newTab(wslShell)
    const id = allSessionIds(st().tabs[0]!.root)[0]!
    st().setSessionCwd(id, "/home/me/wsltest") // a Linux path
    render(<FilesPanel />)
    const row = await waitFor(() => screen.getByText("app.ts"))
    fireEvent.mouseDown(row, { button: 0 })
    // No longer guarded out on WSL; the distro travels so main reads it via the UNC share.
    expect(st().preview).toMatchObject({
      abs: "/home/me/wsltest/app.ts",
      wsl: { distro: "Ubuntu" },
    })
  })
})
