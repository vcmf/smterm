import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AgentsPanel } from "./agents-panel"
import { useStore } from "../store"
import { reduceAgentEvents } from "../lib/agent-graph"
import { resetStore } from "../test/helpers"

// A root session (in pane "p") at /repo/app that created a worktree.
const seed = () =>
  reduceAgentEvents([
    { event: "SessionStart", sessionId: "s", cwd: "/repo/app", paneId: "p" },
    { event: "UserPromptSubmit", sessionId: "s" },
    {
      event: "WorktreeCreate",
      sessionId: "s",
      worktreePath: "/repo/.wt/feat",
      baseBranch: "feat/x",
    },
  ])

describe("AgentsPanel", () => {
  beforeEach(() => {
    resetStore()
    useStore.setState({ agents: seed() })
  })

  it("shows the session root's folder and its worktree branch", () => {
    render(<AgentsPanel />)
    expect(screen.getByText("app")).toBeInTheDocument() // base(/repo/app)
    expect(screen.getByText("feat/x")).toBeInTheDocument() // worktree branch
  })

  it("clicking the folder opens a terminal there (agent's pane context)", () => {
    const spy = vi.fn()
    useStore.setState({ openFolderInSplit: spy })
    render(<AgentsPanel />)
    fireEvent.click(screen.getByTitle("Open a terminal here — /repo/app"))
    expect(spy).toHaveBeenCalledWith("/repo/app", "p")
  })

  it("clicking a worktree opens it", () => {
    const spy = vi.fn()
    useStore.setState({ openFolderInSplit: spy })
    render(<AgentsPanel />)
    fireEvent.click(screen.getByTitle("Open a terminal here — /repo/.wt/feat"))
    expect(spy).toHaveBeenCalledWith("/repo/.wt/feat", "p")
  })

  it("empty when no agents are running", () => {
    useStore.setState({ agents: reduceAgentEvents([]) })
    render(<AgentsPanel />)
    expect(screen.getByText(/No agents yet/)).toBeInTheDocument()
  })
})
