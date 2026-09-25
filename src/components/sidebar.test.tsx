import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { Sidebar } from "./sidebar"
import { useStore } from "../store"
import { allSessionIds } from "../lib/pane-tree"
import { resetStore, testShell } from "../test/helpers"

vi.mock("../terminal/terminal-manager", () => ({
  TerminalManager: { attach: vi.fn(), fit: vi.fn(), focus: vi.fn(), dispose: vi.fn() },
}))

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("Sidebar", () => {
  it("renders the header, legend, and session tree", () => {
    st().newTab(testShell)
    st().renameTab(st().tabs[0]!.id, "work")
    render(<Sidebar />)
    expect(screen.getByText("Sessions")).toBeInTheDocument()
    expect(screen.getByText("work")).toBeInTheDocument() // session (tab) row
    expect(screen.getByText("1 pane")).toBeInTheDocument()
    expect(screen.getByText("running")).toBeInTheDocument()
    expect(screen.getByText("needs input")).toBeInTheDocument()
  })

  it("the header + button opens a new session (tab)", () => {
    render(<Sidebar />)
    expect(st().tabs).toHaveLength(0)
    fireEvent.click(screen.getByTitle("New session"))
    expect(st().tabs).toHaveLength(1)
  })

  it("shows a pane row per session with its status word", () => {
    st().newTab(testShell)
    render(<Sidebar />)
    // "idle" appears both as the pane meta and the legend
    expect(screen.getAllByText("idle").length).toBeGreaterThanOrEqual(1)
    // shell-type badge is shown (uppercased via CSS; textContent is "sh")
    expect(screen.getAllByText("sh").length).toBeGreaterThan(0)
  })

  it("shows the attention reason as a subline", () => {
    st().newTab(testShell)
    const id = allSessionIds(st().tabs[0]!.root)[0]!
    useStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        [id]: { ...s.sessions[id]!, status: "attention", detail: "Claude needs your permission" },
      },
    }))
    render(<Sidebar />)
    expect(screen.getByText("Claude needs your permission")).toBeInTheDocument()
  })

  it("clicking a pane row focuses that session", () => {
    st().newTab(testShell)
    st().splitActive("row", testShell)
    const ids = allSessionIds(st().tabs[0]!.root)
    // Distinct cwds → distinct derived titles so we can target one pane.
    st().setSessionCwd(ids[0]!, "/w/alpha")
    st().setSessionCwd(ids[1]!, "/w/beta")
    render(<Sidebar />)
    fireEvent.mouseDown(screen.getByText("alpha"))
    expect(st().tabs[0]!.activeSessionId).toBe(ids[0])
  })
})

describe("Sidebar — Claude icon", () => {
  it("a terminal running Claude shows the Claude icon; back to the terminal icon when it ends", () => {
    st().newTab(testShell)
    const id = allSessionIds(st().tabs[0]!.root)[0]!
    const { container } = render(<Sidebar />)
    const icon = () => container.querySelector('[data-icon="claude"]')
    expect(icon()).toBeNull()
    act(() => st().applyAgentEvents([{ event: "SessionStart", sessionId: "c1", paneId: id }]))
    expect(icon()).not.toBeNull()
    act(() => st().claudeExited(id)) // prompt came back without a SessionEnd (crash)
    expect(icon()).toBeNull()
  })
})

describe("Sidebar — branch, PR and Claude snippet", () => {
  it("shows the terminal's branch, its PR (link opens it) and Claude's last reply", async () => {
    const { ipc } = await import("../lib/ipc")
    st().newTab(testShell)
    const id = st().tabs[0]!.activeSessionId
    st().setSessionCwd(id, "/w/term")
    st().setPaneGit(
      { [id]: { branch: "feat/x", pr: { number: 51, state: "merged", url: "https://x/51" } } },
      [id],
    )
    st().applyAgentEvents([
      { event: "SessionStart", sessionId: "c1", paneId: id },
      { event: "Stop", sessionId: "c1", paneId: id, message: "**All done** — PR is up." },
    ])
    render(<Sidebar />)
    expect(screen.getAllByText(/feat\/x/).length).toBeGreaterThan(0)
    expect(screen.getByText("merged")).toBeInTheDocument()
    expect(screen.getByText("All done — PR is up.")).toBeInTheDocument()
    fireEvent.click(screen.getByText("PR #51"))
    expect(ipc.openExternal).toHaveBeenCalledWith("https://x/51")
  })
})

describe("Sidebar — from / in folders", () => {
  const setup = () => {
    st().newTab(testShell)
    const id = st().tabs[0]!.activeSessionId
    st().setSessionCwd(id, "/w/term")
    return id
  }

  it("one folder line while Claude works where it started", () => {
    const id = setup()
    st().applyAgentEvents([{ event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/term" }])
    render(<Sidebar />)
    expect(screen.queryByText("from")).toBeNull()
    expect(screen.queryByText("in")).toBeNull()
  })

  it("from + in once Claude moves into a worktree; the PR follows `in`; +N other worktrees", () => {
    const id = setup()
    st().applyAgentEvents([
      { event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/term" },
      { event: "WorktreeCreate", sessionId: "c1", paneId: id, worktreePath: "/w/term/wt/b" },
      { event: "CwdChanged", sessionId: "c1", paneId: id, cwd: "/w/term/.claude/worktrees/a" },
    ])
    st().setPaneGit(
      {
        [id]: { branch: "main", pr: { number: 1, state: "merged", url: "https://x/1" } },
        [`${id}@in`]: { branch: "feat/a", pr: { number: 57, state: "open", url: "https://x/57" } },
      },
      [id, `${id}@in`],
    )
    render(<Sidebar />)
    expect(screen.getByText("from")).toBeInTheDocument()
    expect(screen.getByText("in")).toBeInTheDocument()
    expect(screen.getByText(/feat\/a • \.claude\/worktrees\/a/)).toBeInTheDocument()
    expect(screen.getByText("PR #57")).toBeInTheDocument()
    expect(screen.queryByText("PR #1")).toBeNull()
    expect(screen.getByText("+1")).toHaveAttribute("title", expect.stringContaining("/w/term/wt/b"))
  })

  it("back to one line when Claude exits; closing the pane drops its `in` git info", () => {
    const id = setup()
    st().applyAgentEvents([{ event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/api" }])
    st().setPaneGit({ [`${id}@in`]: { branch: "dev" } }, [`${id}@in`])
    render(<Sidebar />)
    expect(screen.getByText(/dev • \/w\/api/)).toBeInTheDocument()
    act(() => st().claudeExited(id))
    expect(screen.queryByText("in")).toBeNull()
    act(() => st().closeSurface(st().tabs[0]!.id, id))
    expect(st().paneGit[`${id}@in`]).toBeUndefined()
  })
})
