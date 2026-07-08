import { useEffect, useRef } from "react"
import { Terminal, X, Columns, Rows } from "@phosphor-icons/react"
import { TerminalManager } from "../terminal/terminal-manager"
import { useStore } from "../store"
import { displaySessionTitle, shellType } from "../lib/session-label"

/** A mount point for one session's terminal. The terminal itself lives in
 *  TerminalManager, so this component can mount/unmount freely. */
export function TerminalPane({ sessionId, tabId }: { sessionId: string; tabId: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const session = useStore((s) => s.sessions[sessionId])
  const home = useStore((s) => s.home)
  const focused = useStore(
    (s) =>
      s.activeTabId === tabId && s.tabs.find((t) => t.id === tabId)?.activeSessionId === sessionId,
  )
  const status = session?.status ?? "idle"

  // Quick split (cmux-style): split THIS pane with the default shell.
  const split = (direction: "row" | "column") => {
    const store = useStore.getState()
    const shell = store.shells[0]
    if (!shell) return
    store.setActivePane(tabId, sessionId)
    store.splitActive(direction, shell)
  }

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const s = useStore.getState().sessions[sessionId]
    if (!s) return
    TerminalManager.attach(s, el)
    const ro = new ResizeObserver(() => TerminalManager.fit(sessionId))
    ro.observe(el)
    // Do NOT dispose on unmount — the terminal is reused on re-attach.
    // Disposal happens when the session leaves the store (App reconciler).
    return () => ro.disconnect()
  }, [sessionId])

  const railClass = focused ? " focused" : status === "attention" ? " waiting" : ""

  return (
    <div
      className={`terminal-pane${railClass}`}
      onMouseDown={() => useStore.getState().setActivePane(tabId, sessionId)}
      // Re-focus the terminal after any click/selection so keystrokes reach the
      // PTY (the textarea doesn't always keep focus after a selection).
      onMouseUp={() => TerminalManager.focus(sessionId)}
    >
      <div className="pane-header">
        <Terminal size={14} weight="fill" color={focused ? "var(--accent)" : "var(--dim)"} />
        <span className="pane-title">{displaySessionTitle(session, home)}</span>
        <span className="pane-badge">{shellType(session?.command ?? "")}</span>
        <div className="pane-header-spacer" />
        <button
          className="iconbtn"
          style={{ width: 22, height: 22 }}
          title="Split right"
          onMouseDown={(e) => {
            e.stopPropagation()
            split("row")
          }}
        >
          <Columns size={13} />
        </button>
        <button
          className="iconbtn"
          style={{ width: 22, height: 22 }}
          title="Split down"
          onMouseDown={(e) => {
            e.stopPropagation()
            split("column")
          }}
        >
          <Rows size={13} />
        </button>
        <button
          className="iconbtn"
          style={{ width: 22, height: 22 }}
          title="Close pane"
          onMouseDown={(e) => {
            e.stopPropagation()
            useStore.getState().closePane(tabId, sessionId)
          }}
        >
          <X size={13} />
        </button>
      </div>
      <div className="terminal-mount" ref={mountRef} />
    </div>
  )
}
