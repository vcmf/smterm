import { describe, it, expect } from "vitest"
import { reduceAgentEvent, reduceAgentEvents, emptyGraph } from "./agent-graph"
import type { AgentEvent } from "./agent-graph"

// Authentic fixture: the interactive 6a spike run, where the root launched an
// `Explore` sub-agent that read several docs. Trimmed to the shape the receiver emits.
const S = "sess-1"
const A = "expl-1"
const EXPLORE_RUN: AgentEvent[] = [
  { event: "SessionStart", sessionId: S, cwd: "/repo" },
  { event: "UserPromptSubmit", sessionId: S },
  { event: "PreToolUse", sessionId: S, toolName: "Agent" }, // root launches the sub-agent
  { event: "SubagentStart", sessionId: S, agentId: A, agentType: "Explore" },
  { event: "PreToolUse", sessionId: S, agentId: A, toolName: "Bash" },
  {
    event: "PreToolUse",
    sessionId: S,
    agentId: A,
    toolName: "Read",
    filePath: "/repo/docs/ARCHITECTURE.md",
  },
  {
    event: "PostToolUse",
    sessionId: S,
    agentId: A,
    toolName: "Read",
    filePath: "/repo/docs/ARCHITECTURE.md",
  },
  {
    event: "PreToolUse",
    sessionId: S,
    agentId: A,
    toolName: "Read",
    filePath: "/repo/docs/ROADMAP.md",
  },
  {
    event: "PostToolUse",
    sessionId: S,
    agentId: A,
    toolName: "Read",
    filePath: "/repo/docs/ROADMAP.md",
  },
  { event: "PostToolUse", sessionId: S, agentId: A, toolName: "Bash" },
  { event: "SubagentStop", sessionId: S, agentId: A, message: "Summary: this is smterm." },
  { event: "PostToolUse", sessionId: S, toolName: "Agent" }, // root's Agent tool completes
  { event: "Stop", sessionId: S },
  { event: "Notification", sessionId: S, message: "needs your input" },
  { event: "SessionEnd", sessionId: S },
]

describe("agent-graph — the interactive Explore run", () => {
  it("reconstructs one root with one Explore sub-agent", () => {
    const g = reduceAgentEvents(EXPLORE_RUN)
    expect(g.rootIds).toEqual(["root:sess-1"])
    const root = g.nodes["root:sess-1"]!
    expect(root.agentType).toBe("root")
    expect(root.childIds).toEqual([A])
    const sub = g.nodes[A]!
    expect(sub.agentType).toBe("Explore")
    expect(sub.parentId).toBe("root:sess-1")
  })

  it("attributes the sub-agent's file reads to the sub-agent (most-recent-first)", () => {
    const g = reduceAgentEvents(EXPLORE_RUN)
    expect(g.nodes[A]!.recentFiles).toEqual(["/repo/docs/ROADMAP.md", "/repo/docs/ARCHITECTURE.md"])
    expect(g.nodes["root:sess-1"]!.recentFiles).toEqual([]) // root read nothing itself
  })

  it("marks the sub-agent done with its final message; clears its current tool", () => {
    const g = reduceAgentEvents(EXPLORE_RUN)
    expect(g.nodes[A]!.status).toBe("done")
    expect(g.nodes[A]!.currentTool).toBeUndefined()
    expect(g.nodes[A]!.lastMessage).toBe("Summary: this is smterm.")
  })

  it("ends the root as done after SessionEnd", () => {
    const g = reduceAgentEvents(EXPLORE_RUN)
    expect(g.nodes["root:sess-1"]!.status).toBe("done")
  })
})

describe("agent-graph — status transitions", () => {
  const upto = (event: string) => {
    const i = EXPLORE_RUN.findIndex((e) => e.event === event)
    return reduceAgentEvents(EXPLORE_RUN.slice(0, i + 1))
  }

  it("sub-agent is working (with its current tool) mid-run", () => {
    // up to the first Explore 'Read' PreToolUse
    const g = reduceAgentEvents(EXPLORE_RUN.slice(0, 6))
    expect(g.nodes[A]!.status).toBe("working")
    expect(g.nodes[A]!.currentTool).toBe("Read")
  })

  it("Notification flips the root to waiting (needs attention)", () => {
    expect(upto("Notification").nodes["root:sess-1"]!.status).toBe("waiting")
  })

  it("Stop leaves the root idle", () => {
    expect(upto("Stop").nodes["root:sess-1"]!.status).toBe("idle")
  })
})

describe("agent-graph — attribution & edges", () => {
  it("a root tool call updates the root, not the sub-agent", () => {
    const g = reduceAgentEvents([
      { event: "SessionStart", sessionId: S },
      { event: "SubagentStart", sessionId: S, agentId: A, agentType: "Explore" },
      { event: "PreToolUse", sessionId: S, toolName: "Edit", filePath: "/repo/x.ts" }, // root, no agentId
    ])
    expect(g.nodes["root:sess-1"]!.currentTool).toBe("Edit")
    expect(g.nodes["root:sess-1"]!.recentFiles).toEqual(["/repo/x.ts"])
    expect(g.nodes[A]!.currentTool).toBeUndefined()
    expect(g.nodes[A]!.recentFiles).toEqual([])
  })

  it("lazily creates a sub-agent node if a tool event precedes its SubagentStart", () => {
    const g = reduceAgentEvents([
      { event: "SessionStart", sessionId: S },
      {
        event: "PreToolUse",
        sessionId: S,
        agentId: A,
        agentType: "general-purpose",
        toolName: "Grep",
      },
    ])
    expect(g.nodes["root:sess-1"]!.childIds).toEqual([A])
    expect(g.nodes[A]!.agentType).toBe("general-purpose")
    expect(g.nodes[A]!.currentTool).toBe("Grep")
  })
})

describe("agent-graph — sessions & edge cases", () => {
  it("tracks multiple sessions independently; an aborted session ends done with no children", () => {
    const g = reduceAgentEvents([
      { event: "SessionStart", sessionId: "s-a" },
      { event: "SessionEnd", sessionId: "s-a" }, // opened then closed, no prompt
      { event: "SessionStart", sessionId: "s-b" },
      { event: "UserPromptSubmit", sessionId: "s-b" },
    ])
    expect(g.rootIds).toEqual(["root:s-a", "root:s-b"])
    expect(g.nodes["root:s-a"]!.status).toBe("done")
    expect(g.nodes["root:s-a"]!.childIds).toEqual([])
    expect(g.nodes["root:s-b"]!.status).toBe("working")
  })

  it("caps recentFiles at 10, most-recent-first", () => {
    const events: AgentEvent[] = [{ event: "SessionStart", sessionId: S }]
    for (let i = 0; i < 15; i++)
      events.push({ event: "FileChanged", sessionId: S, filePath: `/repo/f${i}.ts` })
    const files = reduceAgentEvents(events).nodes["root:sess-1"]!.recentFiles
    expect(files).toHaveLength(10)
    expect(files[0]).toBe("/repo/f14.ts")
    expect(files[9]).toBe("/repo/f5.ts")
  })

  it("dedupes a repeated file to the front", () => {
    const g = reduceAgentEvents([
      { event: "SessionStart", sessionId: S },
      { event: "FileChanged", sessionId: S, filePath: "/repo/a.ts" },
      { event: "FileChanged", sessionId: S, filePath: "/repo/b.ts" },
      { event: "FileChanged", sessionId: S, filePath: "/repo/a.ts" },
    ])
    expect(g.nodes["root:sess-1"]!.recentFiles).toEqual(["/repo/a.ts", "/repo/b.ts"])
  })

  it("ignores unknown events without throwing or mutating the input graph", () => {
    const before = reduceAgentEvents([{ event: "SessionStart", sessionId: S }])
    const after = reduceAgentEvent(before, { event: "SomethingNew", sessionId: S })
    expect(after.nodes["root:sess-1"]!.status).toBe(before.nodes["root:sess-1"]!.status)
    // input graph object is not mutated
    expect(before.nodes["root:sess-1"]!.status).toBe("idle")
  })

  it("empty stream ⇒ empty graph", () => {
    expect(reduceAgentEvents([])).toEqual(emptyGraph)
  })
})
