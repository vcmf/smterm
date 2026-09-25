import { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  CaretDown,
  CaretRight,
  GitMerge,
  GitPullRequest,
  Plus,
  Terminal,
} from "@phosphor-icons/react"
import { activeTheme, useStore } from "../store"
import { sessionColor } from "../lib/session-color"
import { claudePaneIds } from "../lib/agent-graph"
import { claudeWorkFlat, inGitKey, inLabel, worksElsewhere } from "../lib/agent-dirs"
import { ClaudeIcon } from "./claude-icon"
import { messageSnippet, prStateUi, type PaneGitInfo, type PrInfo } from "../lib/pane-git"
import { ipc } from "../lib/ipc"
import { TerminalManager } from "../terminal/terminal-manager"
import { allPanes } from "../lib/pane-tree"
import { resolveDefaultShell } from "../lib/shells"
import { statusUi } from "../lib/status-ui"
import {
  tabTitle,
  sessionSubline,
  branchLine,
  displaySessionTitle,
  shellType,
} from "../lib/session-label"

/** Left sidebar: a tree of real sessions (tabs) → panes, with live status dots. */
export function Sidebar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const sessions = useStore((s) => s.sessions)
  const shells = useStore((s) => s.shells)
  const defaultShellPref = useStore((s) => s.settings.defaultShell)
  const paneGit = useStore((s) => s.paneGit) // branch + PR per terminal (polled in App)
  // Claude's last reply per pane (newest session root that ran in it), as a flat
  // [paneId, message, …] list of primitives: the shallow compare keeps the sidebar from
  // re-rendering on every agent hook event — only when a reply actually changes.
  const replies = useStore(
    useShallow((s) => {
      const latest: Record<string, string> = {}
      for (const rid of s.agents.rootIds) {
        const n = s.agents.nodes[rid]
        if (n?.paneId && n.lastMessage) latest[n.paneId] = n.lastMessage
      }
      return Object.entries(latest).flat()
    }),
  )
  const home = useStore((s) => s.home)
  // Claude session colours per terminal (same as the pane border + tab icon).
  const agentMeta = useStore((s) => s.agentMeta)
  const scheme = useStore((s) => activeTheme(s).scheme)
  const accentOf = (id: string) => sessionColor(agentMeta[id], scheme)
  // Terminals running Claude (shallow-compared list: re-render only when the set changes).
  const claudePanes = useStore(useShallow((s) => claudePaneIds(s.agents)))
  // Where each pane's Claude works, as memoized primitives: the shallow compare re-renders
  // only when a folder changes, not on every hook event.
  const workFlat = useStore(useShallow((s) => claudeWorkFlat(s.agents)))
  const work: Record<string, { cwd: string; others: string }> = {}
  for (let i = 0; i + 2 < workFlat.length; i += 3)
    work[workFlat[i]!] = { cwd: workFlat[i + 1]!, others: workFlat[i + 2]! }

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const defaultShell = resolveDefaultShell(shells, defaultShellPref)
  const newSession = () => {
    if (defaultShell) useStore.getState().newTab(defaultShell)
  }

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

  const branchFor = (sessionId: string) => paneGit[sessionId]?.branch

  const lastMessage: Record<string, string> = {}
  for (let k = 0; k + 1 < replies.length; k += 2) lastMessage[replies[k]!] = replies[k + 1]!

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="section-label">Sessions</span>
        <button
          className="iconbtn"
          title="New session"
          disabled={!defaultShell}
          onClick={newSession}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="tree">
        {tabs.map((tab) => {
          const panes = allPanes(tab.root) // one walk → ids, pane count, visible set
          const ids = panes.flatMap((p) => p.sessionIds)
          const paneCount = panes.length
          const visible = new Set(panes.map((p) => p.activeSessionId))
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
                  {paneCount} {paneCount === 1 ? "pane" : "panes"}
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
                      // A surface hidden behind another in its pane reads dimmer.
                      className={`tree-row${isActive ? " active" : ""}${visible.has(id) ? "" : " surface-hidden"}`}
                      style={{ paddingLeft: 32 }}
                      onMouseDown={() => focusPane(tab.id, id)}
                    >
                      <span className="tree-icon">
                        {(() => {
                          const Icon = claudePanes.includes(id) ? ClaudeIcon : Terminal
                          return (
                            <Icon
                              size={14}
                              weight="fill"
                              color={accentOf(id) ?? (isActive ? "var(--accent)" : "var(--dim)")}
                            />
                          )
                        })()}
                      </span>
                      <div className="tree-labels">
                        <span className="tree-primary-row">
                          <span className="tree-primary">{displaySessionTitle(s, home)}</span>
                          <span className="pane-badge">{shellType(s.command)}</span>
                        </span>
                        {s.status === "attention" && s.detail ? (
                          <span className="tree-sub attn">{s.detail}</span>
                        ) : (
                          lastMessage[id] && (
                            <span className="tree-snippet" title={lastMessage[id]}>
                              {messageSnippet(lastMessage[id])}
                            </span>
                          )
                        )}
                        <DirLines
                          shellCwd={s.cwd}
                          home={home}
                          shellGit={paneGit[id]}
                          inGit={paneGit[inGitKey(id)]}
                          work={work[id]}
                        />
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

/** The folder line(s): one when Claude works where it started (or isn't running); else
 *  `from` (the shell's folder — where the session is saved) + `in` (where Claude works now). */
function DirLines({
  shellCwd,
  home,
  shellGit,
  inGit,
  work,
}: {
  shellCwd: string | undefined
  home: string
  shellGit: PaneGitInfo | undefined
  inGit: PaneGitInfo | undefined
  work: { cwd: string; others: string } | undefined
}) {
  const extra = work?.others ? work.others.split("\n").length : 0
  const more = extra > 0 && (
    <span className="tree-more" title={`Other worktrees of this session:\n${work!.others}`}>
      +{extra}
    </span>
  )
  if (!shellCwd || !work || !worksElsewhere(shellCwd, work.cwd, shellGit, inGit)) {
    return (
      <>
        <span className="tree-sub tree-dir">
          <span className="tree-dir-path">
            {sessionSubline(shellCwd, home, shellGit?.branch) || "shell"}
          </span>
          {more}
        </span>
        {shellGit?.pr && <PrLine pr={shellGit.pr} />}
      </>
    )
  }
  // Each line keeps its own PR: the session belongs to `from`'s branch, the work to `in`'s.
  return (
    <>
      <span
        className="tree-sub tree-dir"
        title="Claude started here. The session is saved under this folder."
      >
        <span className="tree-dir-label">from</span>
        <span className="tree-dir-path">{sessionSubline(shellCwd, home, shellGit?.branch)}</span>
      </span>
      {shellGit?.pr && <PrLine pr={shellGit.pr} />}
      <span className="tree-sub tree-dir" title={`Claude is working here now: ${work.cwd}`}>
        <span className="tree-dir-label">in</span>
        <span className="tree-dir-path">
          {branchLine(inGit?.branch, inLabel(shellCwd, work.cwd, home, shellGit?.root))}
        </span>
        {more}
      </span>
      {inGit?.pr && <PrLine pr={inGit.pr} />}
    </>
  )
}

/** "⎇ PR #51 merged" — the number opens the PR in the browser; the state is colour-coded. */
function PrLine({ pr }: { pr: PrInfo }) {
  const ui = prStateUi(pr.state)
  const Icon = pr.state === "merged" ? GitMerge : GitPullRequest
  return (
    <span className="tree-pr">
      <Icon size={12} color={`var(--${ui.color})`} />
      <button
        className="tree-pr-link"
        title={pr.url}
        // Don't let the row's mousedown focus the pane — this is a link.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => ipc.openExternal(pr.url)}
      >
        PR #{pr.number}
      </button>
      <span style={{ color: `var(--${ui.color})` }}>{ui.word}</span>
    </span>
  )
}
