import { useStore } from "../store"
import { RIGHT_PANEL_DEFAULT } from "../lib/right-panel"

// Drag handle on the right panel's left edge. Dragging left widens it; the store
// clamps to [MIN, min(MAX, 60% of the window)] so it can't swallow the terminals.
// Double-click resets to the default width.
export function RightPanelResizer() {
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = useStore.getState().rightPanelWidth
    const onMove = (ev: PointerEvent) => {
      // clientX decreasing (drag left) → wider panel.
      useStore
        .getState()
        .setRightPanelWidth(startWidth + (startX - ev.clientX), window.innerWidth * 0.6)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  return (
    <div
      className="rightpanel-resizer"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().setRightPanelWidth(RIGHT_PANEL_DEFAULT)}
    />
  )
}
