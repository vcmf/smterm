import { useEffect, useRef } from "react"
import { useStore } from "../store"
import { clampPanelWidth, RIGHT_PANEL_DEFAULT } from "../lib/right-panel"

// Panel width never wider than this fraction of the window (keeps room for terminals).
const maxAvail = () => window.innerWidth * 0.6
// Set the live width without a store write (so a drag doesn't re-render the App subtree
// every frame — the store, and its persistence, is committed once on release).
const setVar = (px: number) => document.documentElement.style.setProperty("--rpw", `${px}px`)

// Drag handle on the right panel's left edge. Dragging left widens it; the width is
// clamped to [MIN, min(MAX, 60% of the window)]. Arrow keys resize too (a11y),
// double-click resets to the default.
export function RightPanelResizer() {
  const drag = useRef<{ x: number; w: number } | null>(null)

  // Safety net: if the panel is closed mid-drag, drop the drag styling.
  useEffect(() => () => document.body.classList.remove("resizing-col"), [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { x: e.clientX, w: useStore.getState().rightPanelWidth }
    e.currentTarget.setPointerCapture(e.pointerId) // auto-released on unmount → no leak
    document.body.classList.add("resizing-col")
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setVar(clampPanelWidth(drag.current.w + (drag.current.x - e.clientX), maxAvail()))
  }
  const end = () => {
    if (!drag.current) return
    // Commit the live width to the store (clamped) — this is what persists.
    const px = parseInt(document.documentElement.style.getPropertyValue("--rpw"), 10)
    if (Number.isFinite(px)) useStore.getState().setRightPanelWidth(px, maxAvail())
    drag.current = null
    document.body.classList.remove("resizing-col")
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 96 : 24
    const w = useStore.getState().rightPanelWidth
    if (e.key === "ArrowLeft") useStore.getState().setRightPanelWidth(w + step, maxAvail())
    else if (e.key === "ArrowRight") useStore.getState().setRightPanelWidth(w - step, maxAvail())
    else return
    e.preventDefault()
  }

  return (
    <div
      className="rightpanel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onLostPointerCapture={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => useStore.getState().setRightPanelWidth(RIGHT_PANEL_DEFAULT, maxAvail())}
    />
  )
}
