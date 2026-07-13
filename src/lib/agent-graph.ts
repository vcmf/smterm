// Pure reducer that folds a stream of Claude Code hook events into a live tree of
// agents + their status/cwd/recent-files. The risky logic of M6 lives here, tested
// against real captured hook streams (see agent-graph.test.ts). No I/O, no time —
// the receiver normalises raw hook JSON into AgentEvent and calls reduceAgentEvent.
//
// Correlation model (validated by the 6a spike — see docs/design/AGENT_OBSERVABILITY.md):
//   - root agent  = events with NO agent_id (the session itself)
//   - sub-agent   = events carrying an agent_id (attach to their session's root)
// Two levels (root → sub-agents); deeper nesting needs OTEL's parent_agent_id (6c).

export type AgentStatus = "working" | "waiting" | "idle" | "done"

/** A hook event normalised down to the fields the graph needs. */
export interface AgentEvent {
  event: string // hook_event_name (SessionStart, PreToolUse, SubagentStart, …)
  sessionId: string
  agentId?: string // absent ⇒ the session root; present ⇒ a sub-agent
  agentType?: string // e.g. "Explore", "general-purpose" (sub-agents only)
  cwd?: string
  toolName?: string // tool_name on Pre/PostToolUse
  filePath?: string // extracted from a file tool's input, or a FileChanged path
  message?: string // Notification message / last_assistant_message
}

export interface AgentNode {
  id: string // agent_id, or `root:<sessionId>` for a session root
  sessionId: string
  agentType: string // "root" for the session root, else the sub-agent type
  status: AgentStatus
  currentTool?: string // in-flight tool (set on PreToolUse, cleared on PostToolUse)
  cwd?: string
  recentFiles: string[] // most-recent-first, capped
  lastMessage?: string
  parentId?: string // undefined for a root
  childIds: string[] // sub-agents, in order of appearance
}

export interface AgentGraph {
  nodes: Record<string, AgentNode>
  rootIds: string[] // one root per session, in order of first appearance
}

export const emptyGraph: AgentGraph = { nodes: {}, rootIds: [] }

const RECENT_FILES_CAP = 10
const rootId = (sessionId: string) => `root:${sessionId}`

/** Prepend a file, dedupe, cap. No-op when path is absent. */
const withFile = (files: string[], path?: string): string[] =>
  path ? [path, ...files.filter((p) => p !== path)].slice(0, RECENT_FILES_CAP) : files

/** Fold one hook event into the graph, returning a new graph (pure). */
export function reduceAgentEvent(graph: AgentGraph, ev: AgentEvent): AgentGraph {
  const nodes = { ...graph.nodes }
  let rootIds = graph.rootIds
  const rid = rootId(ev.sessionId)
  // Every id read below is ensured to exist first (root always; sub-agent when
  // agentId is present), so this accessor is safe despite noUncheckedIndexedAccess.
  const at = (id: string) => nodes[id] as AgentNode

  // Every event belongs to a session → ensure that session's root node exists.
  if (!nodes[rid]) {
    nodes[rid] = {
      id: rid,
      sessionId: ev.sessionId,
      agentType: "root",
      status: "idle",
      cwd: ev.cwd,
      recentFiles: [],
      childIds: [],
    }
    rootIds = [...rootIds, rid]
  }

  // A sub-agent event may arrive before its SubagentStart — create it lazily and
  // attach it to the session root (two-level tree).
  if (ev.agentId && !nodes[ev.agentId]) {
    nodes[ev.agentId] = {
      id: ev.agentId,
      sessionId: ev.sessionId,
      agentType: ev.agentType ?? "agent",
      status: "working",
      cwd: ev.cwd,
      recentFiles: [],
      parentId: rid,
      childIds: [],
    }
    const root = at(rid)
    if (!root.childIds.includes(ev.agentId)) {
      nodes[rid] = { ...root, childIds: [...root.childIds, ev.agentId] }
    }
  }

  const targetId = ev.agentId ?? rid
  const set = (id: string, changes: Partial<AgentNode>) => {
    nodes[id] = { ...at(id), ...changes }
  }

  switch (ev.event) {
    case "SessionStart":
      set(rid, { status: "idle", cwd: ev.cwd ?? at(rid).cwd })
      break
    case "UserPromptSubmit":
      set(rid, { status: "working" })
      break
    case "SubagentStart":
      if (ev.agentId)
        set(ev.agentId, {
          agentType: ev.agentType ?? at(ev.agentId).agentType,
          status: "working",
        })
      break
    case "PreToolUse":
      set(targetId, {
        status: "working",
        currentTool: ev.toolName,
        cwd: ev.cwd ?? at(targetId).cwd,
        recentFiles: withFile(at(targetId).recentFiles, ev.filePath),
      })
      break
    case "PostToolUse":
      set(targetId, {
        currentTool: undefined,
        recentFiles: withFile(at(targetId).recentFiles, ev.filePath),
      })
      break
    case "SubagentStop":
      if (ev.agentId)
        set(ev.agentId, {
          status: "done",
          currentTool: undefined,
          lastMessage: ev.message ?? at(ev.agentId).lastMessage,
        })
      break
    case "Stop":
      set(rid, {
        status: "idle",
        currentTool: undefined,
        lastMessage: ev.message ?? at(rid).lastMessage,
      })
      break
    case "Notification":
      set(rid, { status: "waiting", lastMessage: ev.message ?? at(rid).lastMessage })
      break
    case "CwdChanged":
      if (ev.cwd) set(targetId, { cwd: ev.cwd })
      break
    case "FileChanged":
      set(targetId, { recentFiles: withFile(at(targetId).recentFiles, ev.filePath) })
      break
    case "SessionEnd":
      set(rid, { status: "done", currentTool: undefined })
      break
    default:
      break // unknown / uninteresting event — leave state untouched
  }

  return { nodes, rootIds }
}

/** Fold a whole event stream (convenience over reduceAgentEvent). */
export const reduceAgentEvents = (
  events: AgentEvent[],
  graph: AgentGraph = emptyGraph,
): AgentGraph => events.reduce(reduceAgentEvent, graph)
