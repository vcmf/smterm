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

  it("boxes the session whose pane the user is currently in", () => {
    useStore.setState({
      activeTabId: "t",
      tabs: [{ id: "t", title: "t", root: { type: "leaf", sessionId: "p" }, activeSessionId: "p" }],
    })
    const { container } = render(<AgentsPanel />)
    expect(container.querySelector(".agent-session.active")).toBeInTheDocument()
  })

  it("does not box a session whose pane is not focused", () => {
    useStore.setState({
      activeTabId: "t",
      tabs: [
        {
          id: "t",
          title: "t",
          root: { type: "leaf", sessionId: "other" },
          activeSessionId: "other",
        },
      ],
    })
    const { container } = render(<AgentsPanel />)
    expect(container.querySelector(".agent-session.active")).toBeNull()
  })

  it("shows a token badge on a session once usage is known, not before", () => {
    const { rerender } = render(<AgentsPanel />)
    expect(screen.queryByText(/tok$/)).toBeNull() // no tokens yet
    useStore.setState({
      agents: reduceAgentEvents([
        { event: "SessionStart", sessionId: "s", cwd: "/repo/app", paneId: "p" },
        {
          event: "TokenUsage",
          sessionId: "s",
          tokens: { input: 3000, output: 1200, cacheCreate: 500, cacheRead: 90000 },
        },
      ]),
    })
    rerender(<AgentsPanel />)
    expect(screen.getByText("4.7k tok")).toBeInTheDocument() // 3000 + 500 + 1200
  })

  it("draws the tree spine: root is a parent, its last worktree ends the spine", () => {
    render(<AgentsPanel />)
    const root = screen.getByText("session").closest(".diff-file")
    expect(root?.classList.contains("tree-parent")).toBe(true)
    // The single worktree is the last child → elbow only, no through-line.
    const wt = screen.getByText("feat/x").closest(".diff-file")
    expect(wt?.classList.contains("tree-child")).toBe(true)
    expect(wt?.classList.contains("through")).toBe(false)
  })
})
