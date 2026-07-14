import { Fragment } from "react"
import { X, TreeStructure } from "@phosphor-icons/react"
import { useStore } from "../store"
import { TerminalManager } from "../terminal/terminal-manager"
import { displaySessionTitle } from "../lib/session-label"
import type { AgentNode, AgentStatus } from "../lib/agent-graph"

// AgentStatus → dot class (reusing App.css .dot.*) + a short word.
const DOT: Record<AgentStatus, { cls: string; word: string }> = {
  working: { cls: "accent pulse", word: "working" },
  waiting: { cls: "amber", word: "needs input" },
  idle: { cls: "faint", word: "idle" },
  done: { cls: "blue", word: "done" },
}

const base = (p?: string) => (p ? (p.replace(/\/+$/, "").split(/[\\/]/).pop() ?? p) : "")

function AgentRow({
  node,
  depth,
  onFocusPane,
}: {
  node: AgentNode
  depth: number
  onFocusPane?: () => void
}) {
  const d = DOT[node.status]
  const isRoot = node.agentType === "root"
  const primary = isRoot ? "session" : node.agentType
  const sub = isRoot
    ? base(node.cwd) || "—"
    : (node.recentFiles[0] ? base(node.recentFiles[0]) : node.lastMessage?.slice(0, 40)) || "—"
  return (
    <div
      className="diff-file"
      style={{ paddingLeft: 10 + depth * 16, cursor: onFocusPane ? "pointer" : undefined }}
      onMouseDown={onFocusPane}
      title={onFocusPane ? "Go to this pane" : undefined}
    >
      <span className={`dot ${d.cls}`} />
      <div className="tree-labels">
        <span className="tree-primary">
          {primary}
          {node.currentTool && <span className="status-faint"> · {node.currentTool}</span>}
        </span>
        <span className="tree-sub">{sub}</span>
      </div>
      <span className="status-faint">{d.word}</span>
    </div>
  )
}

/** Right-side board of live Claude agents/sub-agents across all tabs & panes (M6). */
export function AgentsPanel() {
  const agents = useStore((s) => s.agents)
  const sessions = useStore((s) => s.sessions)
  const home = useStore((s) => s.home)
  const close = () => useStore.getState().setAgentsPanelOpen(false)

  // Bring the pane that owns this session to the front (switch tab + focus terminal).
  const focusPane = (paneId?: string) => {
    if (!paneId || !sessions[paneId]) return
    useStore.getState().focusSession(paneId)
    TerminalManager.focus(paneId)
  }

  const nodes = Object.values(agents.nodes)
  const working = nodes.filter((n) => n.status === "working").length

  return (
    <div className="diffpanel">
      <div className="diffpanel-header">
        <span className="section-label">Agents</span>
        <span className="diff-summary status-faint">
          {agents.rootIds.length} session{agents.rootIds.length === 1 ? "" : "s"} · {working}{" "}
          working
        </span>
        <button className="iconbtn" style={{ width: 22, height: 22 }} title="Close" onClick={close}>
          <X size={13} />
        </button>
      </div>

      <div className="diff-files agents-files">
        {agents.rootIds.length === 0 && (
          <div className="diff-empty status-faint">
            <TreeStructure size={16} /> No agents yet — run <code>claude</code> in a pane.
          </div>
        )}
        {agents.rootIds.map((rid) => {
          const root = agents.nodes[rid]
          if (!root) return null
          // Header line naming the pane this session runs in (click → jump there).
          const paneSession = root.paneId ? sessions[root.paneId] : undefined
          const paneLabel = paneSession ? displaySessionTitle(paneSession, home) : "external"
          const go = paneSession ? () => focusPane(root.paneId) : undefined
          return (
            <Fragment key={rid}>
              <div
                className="agents-pane-label status-faint"
                onMouseDown={go}
                style={{ cursor: go ? "pointer" : undefined }}
              >
                <TreeStructure size={12} /> {paneLabel}
              </div>
              <AgentRow node={root} depth={0} onFocusPane={go} />
              {root.childIds.map((cid) => {
                const child = agents.nodes[cid]
                return child ? <AgentRow key={cid} node={child} depth={1} onFocusPane={go} /> : null
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
