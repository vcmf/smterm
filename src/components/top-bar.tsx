import { useEffect, useRef, useState } from "react"
import {
  TerminalWindow,
  Plus,
  MagnifyingGlass,
  GearSix,
  GitDiff,
  Minus,
  Square,
  X,
  Copy,
} from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { allSessionIds } from "../lib/pane-tree"
import { aggregateBadge } from "../lib/session-status"
import { tabTitle } from "../lib/session-label"

/** The mux top bar: brand · session tabs · search pill · window controls. */
export function TopBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const shells = useStore((s) => s.shells)
  const sessions = useStore((s) => s.sessions)
  const home = useStore((s) => s.home)
  const diffPanelOpen = useStore((s) => s.diffPanelOpen)
  const [maximized, setMaximized] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    void ipc.isMaximized().then(setMaximized)
    return ipc.onMaximizeChange(setMaximized)
  }, [])

  const defaultShell = shells[0]

  const startRename = (id: string, title: string) => {
    setDraft(title)
    setEditingId(id)
  }
  const commitRename = () => {
    if (editingId) {
      const name = draft.trim()
      if (name) useStore.getState().renameTab(editingId, name)
    }
    setEditingId(null)
  }

  return (
    <div className="topbar">
      <div className="brand">
        <TerminalWindow size={16} weight="fill" />
        <span className="brand-name">smterm</span>
      </div>
      <div className="vdivider" />

      <div className="tabs">
        {tabs.map((tab) => {
          const ids = allSessionIds(tab.root)
          const badge = aggregateBadge(
            ids.flatMap((id) => {
              const s = sessions[id]
              return s ? [{ status: s.status, unread: s.unread }] : []
            }),
          )
          const pulse = badge === "working"
          const dotClass =
            badge === "attention" ? "amber" : badge === "working" ? "accent" : "faint"
          return (
            <div
              key={tab.id}
              className={`tab${tab.id === activeTabId ? " active" : ""}`}
              onMouseDown={() => useStore.getState().setActiveTab(tab.id)}
              onDoubleClick={() => startRename(tab.id, tabTitle(tab, sessions, home))}
            >
              {badge && <span className={`dot ${dotClass}${pulse ? " pulse" : ""}`} />}
              {editingId === tab.id ? (
                <input
                  ref={inputRef}
                  className="tab-rename"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename()
                    else if (e.key === "Escape") setEditingId(null)
                  }}
                />
              ) : (
                <span className="tab-title">{tabTitle(tab, sessions, home)}</span>
              )}
              {ids.length > 1 && <span className="tab-count">{ids.length}</span>}
              <button
                className="tab-close"
                title="Close tab"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  useStore.getState().closeTab(tab.id)
                }}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
        <button
          className="iconbtn"
          title="New tab"
          disabled={!defaultShell}
          onClick={() => defaultShell && useStore.getState().newTab(defaultShell)}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="topbar-right">
        <button className="searchpill" onClick={() => useStore.getState().setPaletteOpen(true)}>
          <MagnifyingGlass size={12} />
          <span>Search or run</span>
          <span className="kbd">⌘K</span>
        </button>
        <button
          className={`iconbtn${diffPanelOpen ? " on" : ""}`}
          title="Toggle changes panel"
          onClick={() => useStore.getState().setDiffPanelOpen(!diffPanelOpen)}
        >
          <GitDiff size={15} />
        </button>
        <button
          className="iconbtn"
          title="Settings"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <GearSix size={15} />
        </button>
        <div className="vdivider" />
        <div className="wincontrols">
          <button className="winbtn" title="Minimize" onClick={() => ipc.minimizeWindow()}>
            <Minus size={11} />
          </button>
          <button
            className="winbtn"
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => ipc.maximizeWindow()}
          >
            {maximized ? <Copy size={11} /> : <Square size={11} />}
          </button>
          <button className="winbtn close" title="Close" onClick={() => ipc.closeWindow()}>
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
