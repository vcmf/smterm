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

  it("one folder line for a `cd` inside the same checkout (same repo root)", () => {
    const id = setup()
    st().applyAgentEvents([
      { event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/term/src" },
    ])
    st().setPaneGit(
      { [id]: { root: "/w/term" }, [`${id}@in`]: { root: "/w/term", forCwd: "/w/term/src" } },
      [],
    )
    render(<Sidebar />)
    expect(screen.queryByText("from")).toBeNull()
  })

  it("one folder line while Claude works where it started", () => {
    const id = setup()
    st().applyAgentEvents([{ event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/term" }])
    render(<Sidebar />)
    expect(screen.queryByText("from")).toBeNull()
    expect(screen.queryByText("in")).toBeNull()
  })

  it("from + in once Claude moves into another checkout (a worktree); each keeps its PR; +N", () => {
    const id = setup()
    st().applyAgentEvents([
      { event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/term" },
      { event: "WorktreeCreate", sessionId: "c1", paneId: id, worktreePath: "/w/term/wt/b" },
      { event: "CwdChanged", sessionId: "c1", paneId: id, cwd: "/w/term/.claude/worktrees/a" },
    ])
    st().setPaneGit(
      {
        [id]: {
          branch: "main",
          root: "/w/term",
          pr: { number: 1, state: "merged", url: "https://x/1" },
        },
        [`${id}@in`]: {
          branch: "feat/a",
          root: "/w/term/.claude/worktrees/a",
          forCwd: "/w/term/.claude/worktrees/a",
          pr: { number: 57, state: "open", url: "https://x/57" },
        },
      },
      [id, `${id}@in`],
    )
    render(<Sidebar />)
    expect(screen.getByText("from")).toBeInTheDocument()
    expect(screen.getByText("in")).toBeInTheDocument()
    expect(screen.getByText(/feat\/a • \.claude\/worktrees\/a/)).toBeInTheDocument()
    expect(screen.getByText("PR #57")).toBeInTheDocument()
    expect(screen.getByText("PR #1")).toBeInTheDocument() // the session's own branch PR stays
    expect(screen.getByText("+1")).toHaveAttribute("title", expect.stringContaining("/w/term/wt/b"))
  })

  it("back to one line when Claude exits; closing the pane drops its `in` git info", () => {
    const id = setup()
    st().applyAgentEvents([{ event: "SessionStart", sessionId: "c1", paneId: id, cwd: "/w/api" }])
    st().setPaneGit({ [`${id}@in`]: { branch: "dev", forCwd: "/w/api" } }, [`${id}@in`])
    render(<Sidebar />)
    expect(screen.getByText(/dev • \/w\/api/)).toBeInTheDocument()
    act(() => st().claudeExited(id))
    expect(screen.queryByText("in")).toBeNull()
    act(() => st().closeSurface(st().tabs[0]!.id, id))
    expect(st().paneGit[`${id}@in`]).toBeUndefined()
  })
})

describe("Sidebar — folder lines: full path + right-click menu", () => {
  const setup = () => {
    st().newTab(testShell)
    const id = st().tabs[0]!.activeSessionId
    st().setSessionCwd(id, "/Users/test/work/term")
    return id
  }

  it("every folder line shows its full path on hover (one line, and from / in)", () => {
    const id = setup()
    const { unmount, container } = render(<Sidebar />)
    const line = container.querySelector(".tree-dir")!
    expect(line).toHaveAttribute("title", "/Users/test/work/term")
    unmount()
    st().applyAgentEvents([{ event: "SessionStart", sessionId: "c", paneId: id, cwd: "/w/api" }])
    st().setPaneGit({ [`${id}@in`]: { real: "/w/api", forCwd: "/w/api" } }, [])
    render(<Sidebar />)
    expect(screen.getByText("from").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("/Users/test/work/term"),
    )
    expect(screen.getByText("in").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("/w/api"),
    )
  })

  it("right-click: copy the path, or open a terminal there beside that pane", async () => {
    const { ipc } = await import("../lib/ipc")
    const id = setup()
    const { container } = render(<Sidebar />)
    const line = () => container.querySelector(".tree-dir")!
    fireEvent.contextMenu(line())
    fireEvent.mouseDown(screen.getByText("Copy path"))
    expect(ipc.clipboardWrite).toHaveBeenCalledWith("/Users/test/work/term")
    fireEvent.contextMenu(line())
    fireEvent.mouseDown(screen.getByText("Open terminal here"))
    const tab = st().tabs[0]!
    expect(allSessionIds(tab.root)).toHaveLength(2) // split beside that pane…
    expect(tab.activeSessionId).not.toBe(id) // …and the new one is focused
    expect(st().sessions[tab.activeSessionId]?.cwd).toBe("/Users/test/work/term")
  })

  it("a right-click doesn't switch to / focus that pane (Escape would reach its Claude)", () => {
    const id = setup()
    st().newTab(testShell) // a second tab is now active
    const other = st().activeTabId
    useStore.setState({ platform: "darwin" }) // Ctrl-click = right-click there
    const { container } = render(<Sidebar />)
    const line = [...container.querySelectorAll(".tree-dir")].find((el) =>
      el.getAttribute("title")?.includes("/Users/test/work/term"),
    )!
    fireEvent.mouseDown(line, { button: 2 })
    fireEvent.mouseDown(line, { button: 0, ctrlKey: true }) // macOS Ctrl-click = right-click
    fireEvent.contextMenu(line)
    expect(st().activeTabId).toBe(other)
    fireEvent.mouseDown(line, { button: 0 }) // a plain left click still focuses it
    expect(st().activeTabId).not.toBe(other)
    void id
  })

  it("Open terminal here keeps the source pane's attention (you never looked at it)", () => {
    const id = setup()
    useStore.setState((x) => ({
      sessions: {
        ...x.sessions,
        [id]: { ...x.sessions[id]!, status: "attention", detail: "permission" },
      },
    }))
    const before = st().sessions[id]?.status
    expect(before).toBe("attention")
    const { container } = render(<Sidebar />)
    fireEvent.contextMenu(container.querySelector(".tree-dir")!)
    fireEvent.mouseDown(screen.getByText("Open terminal here"))
    expect(st().sessions[id]?.status).toBe(before)
  })

  it("Reveal is unavailable for a WSL pane's path", () => {
    st().newTab({ id: "wsl", label: "Ubuntu", command: "wsl.exe", args: ["-d", "Ubuntu"] })
    const id = st().tabs[0]!.activeSessionId
    st().setSessionCwd(id, "/home/u/repo")
    const { container } = render(<Sidebar />)
    fireEvent.contextMenu(container.querySelector(".tree-dir")!)
    expect(screen.getByText("WSL path")).toBeInTheDocument()
    expect(screen.getByText(/Reveal in|Show in/).closest("button")).toBeDisabled()
  })
})
