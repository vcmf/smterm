import { useEffect, useRef, useState } from "react"
import { Settings as SettingsIcon } from "lucide-react"
import { useStore } from "../store"
import { allSessionIds } from "../lib/paneTree"
import { aggregateBadge } from "../lib/sessionStatus"

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const shells = useStore((s) => s.shells)
  const sessions = useStore((s) => s.sessions)
  const [shellId, setShellId] = useState<string | null>(null)

  // Inline tab rename (window.prompt is unavailable in the Tauri webview).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const currentShell = shells.find((s) => s.id === shellId) ?? shells[0]

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
    <div className="tabbar">
      <div className="tabs">
        {tabs.map((tab) => {
          const badge = aggregateBadge(
            allSessionIds(tab.root).flatMap((id) => {
              const s = sessions[id]
              return s ? [{ status: s.status, unread: s.unread }] : []
            }),
          )
          return (
            <div
              key={tab.id}
              className={`tab${tab.id === activeTabId ? " active" : ""}`}
              onMouseDown={() => useStore.getState().setActiveTab(tab.id)}
              onDoubleClick={() => startRename(tab.id, tab.title)}
            >
              {badge && <span className={`badge ${badge}`} title={badge} />}
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
                <span className="tab-title">{tab.title}</span>
              )}
              <button
                className="tab-close"
                title="Close tab"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  useStore.getState().closeTab(tab.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="toolbar">
        <select
          className="shell-select"
          value={currentShell?.id ?? ""}
          onChange={(e) => setShellId(e.target.value)}
        >
          {shells.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="tb-btn"
          title="New tab"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().newTab(currentShell)}
        >
          + Tab
        </button>
        <button
          className="tb-btn"
          title="Split right"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().splitActive("row", currentShell)}
        >
          ⬌
        </button>
        <button
          className="tb-btn"
          title="Split down"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().splitActive("column", currentShell)}
        >
          ⬍
        </button>
        <button
          className="tb-btn icon-btn"
          title="Settings"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <SettingsIcon size={14} />
        </button>
      </div>
    </div>
  )
}
