import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import App from "./app"
import { useStore } from "./store"
import { ipc } from "./lib/ipc"
import { resetStore, testShell } from "./test/helpers"

vi.mock("./terminal/terminal-manager", () => ({
  TerminalManager: {
    attach: vi.fn(),
    fit: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    applySettings: vi.fn(),
    reconcileRenderers: vi.fn(),
  },
}))

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  vi.mocked(ipc.listShells).mockResolvedValue([testShell])
})

describe("App (integration)", () => {
  it("renders the full chrome and opens an initial session", async () => {
    render(<App />)
    // Chrome is present immediately.
    expect(screen.getByText("smterm")).toBeInTheDocument()
    expect(screen.getByText("Sessions")).toBeInTheDocument()
    expect(screen.getByText("Search or run")).toBeInTheDocument()
    // Async effects: platform label + first session from listShells().
    expect(await screen.findByText("macOS")).toBeInTheDocument()
    await waitFor(() => expect(useStore.getState().tabs).toHaveLength(1))
  })

  it("polls git status for the focused session's cwd", async () => {
    render(<App />)
    await waitFor(() => expect(useStore.getState().tabs).toHaveLength(1))
    const id = Object.keys(useStore.getState().sessions)[0]!
    useStore.getState().setSessionCwd(id, "/repo")
    await waitFor(() => expect(ipc.gitStatus).toHaveBeenCalledWith("/repo", undefined)) // no WSL ctx for a native shell
  })
})
