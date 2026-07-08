import { useState } from "react"
import { CaretDown, CaretRight, TreeStructure, Terminal } from "@phosphor-icons/react"
import { useStore } from "../store"
import { TerminalManager } from "../terminal/terminal-manager"
import { allSessionIds } from "../lib/pane-tree"
import { statusUi } from "../lib/status-ui"
import {
  tabTitle,
  shortCwd,
  sessionSubline,
  displaySessionTitle,
  shellType,
} from "../lib/session-label"

/** Left sidebar: a tree of real sessions (tabs) → panes, with live status dots. */
export function Sidebar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const sessions = useStore((s) => s.sessions)
  const git = useStore((s) => s.git)
  const home = useStore((s) => s.home)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const focusPane = (tabId: string, sessionId: string) => {
    const store = useStore.getState()
    store.setActiveTab(tabId)
    store.setActivePane(tabId, sessionId)
    requestAnimationFrame(() => TerminalManager.focus(sessionId))
  }

  // Branch is only known for the focused session's cwd (single git poller).
  const branchFor = (sessionId: string) =>
    activeTabId &&
    tabs.find((t) => t.id === activeTabId)?.activeSessionId === sessionId &&
    git?.isRepo &&
    git.branch
      ? git.branch
      : undefined

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="section-label">Sessions &amp; agents</span>
        <TreeStructure size={14} />
      </div>

      <div className="tree">
        {tabs.map((tab) => {
          const ids = allSessionIds(tab.root)
          const open = !collapsed.has(tab.id)
          const active = tab.id === activeTabId
          const focused = sessions[tab.activeSessionId]
          const groupSub = sessionSubline(focused?.cwd, home, branchFor(tab.activeSessionId))
          return (
            <div key={tab.id}>
              <div
                className={`tree-row${active ? " active" : ""}`}
                style={{ paddingLeft: 12 }}
                onMouseDown={() => useStore.getState().setActiveTab(tab.id)}
              >
                <button
                  className="tree-caret tree-icon"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    toggle(tab.id)
                  }}
                >
                  {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
                </button>
                <div className="tree-labels">
                  <span className="tree-primary-row">
                    <span className="tree-primary session">{tabTitle(tab, sessions, home)}</span>
                    {focused && <span className="pane-badge">{shellType(focused.command)}</span>}
                  </span>
                  {groupSub && <span className="tree-sub">{groupSub}</span>}
                </div>
                <span className="tree-meta status-faint">
                  {ids.length} {ids.length === 1 ? "pane" : "panes"}
                </span>
              </div>

              {open &&
                ids.map((id) => {
                  const s = sessions[id]
                  if (!s) return null
                  const ui = statusUi(s.status)
                  const isActive = active && tab.activeSessionId === id
                  return (
                    <div
                      key={id}
                      className={`tree-row${isActive ? " active" : ""}`}
                      style={{ paddingLeft: 32 }}
                      onMouseDown={() => focusPane(tab.id, id)}
                    >
                      <span className="tree-icon">
                        <Terminal
                          size={14}
                          weight="fill"
                          color={isActive ? "var(--accent)" : "var(--dim)"}
                        />
                      </span>
                      <div className="tree-labels">
                        <span className="tree-primary-row">
                          <span className="tree-primary">{displaySessionTitle(s, home)}</span>
                          <span className="pane-badge">{shellType(s.command)}</span>
                        </span>
                        {s.status === "attention" && s.detail ? (
                          <span className="tree-sub attn">{s.detail}</span>
                        ) : (
                          <span className="tree-sub">{shortCwd(s.cwd, home) || "shell"}</span>
                        )}
                      </div>
                      {s.status !== "attention" && (
                        <span className="tree-meta" style={{ color: `var(--${ui.dot})` }}>
                          {ui.word}
                        </span>
                      )}
                      <span className={`dot ${ui.dot}${ui.pulse ? " pulse" : ""}`} />
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>

      <div className="legend">
        <span className="legend-item">
          <span className="dot accent" /> running
        </span>
        <span className="legend-item">
          <span className="dot amber" /> needs input
        </span>
        <span className="legend-item">
          <span className="dot faint" /> idle
        </span>
      </div>
    </div>
  )
}
