import { useEffect, useRef } from "react"
import { useStore } from "../store"
import { TerminalManager } from "../terminal/terminal-manager"

/** Confirm closing a pane that holds several terminals (all of them get killed). */
export function ClosePaneDialog() {
  const pending = useStore((s) => s.closePaneConfirm)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Hand keyboard focus back to the focused terminal once the dialog is gone.
  const refocus = () =>
    requestAnimationFrame(() => {
      const s = useStore.getState()
      const sid = s.tabs.find((t) => t.id === s.activeTabId)?.activeSessionId
      if (sid) TerminalManager.focus(sid)
    })
  const cancel = () => {
    useStore.getState().cancelClosePane()
    refocus()
  }
  const confirm = () => {
    if (pending) useStore.getState().closePane(pending.tabId, pending.paneId)
    refocus()
  }

  useEffect(() => {
    if (!pending) return
    confirmRef.current?.focus()
    // Window-level, so the trap holds even if focus drifted off the buttons.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        cancel()
      } else if (e.key === "Tab") {
        // Modal: Tab cycles between the two buttons, never out to the terminal behind.
        e.preventDefault()
        const next = document.activeElement === confirmRef.current ? cancelRef : confirmRef
        next.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  if (!pending) return null
  return (
    <div className="settings-overlay" onMouseDown={cancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-labelledby="close-pane-title"
        // preventDefault: clicking the dialog's text must not blur the focused button.
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
      >
        <h2 id="close-pane-title">Close pane with {pending.count} terminals?</h2>
        <p>Every terminal in this pane will be closed and its running processes stopped.</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn" onClick={cancel}>
            Cancel
          </button>
          <button ref={confirmRef} className="btn danger" onClick={confirm}>
            Close pane
          </button>
        </div>
      </div>
    </div>
  )
}
