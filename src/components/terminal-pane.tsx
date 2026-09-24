import { useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Terminal, X, Columns, Rows, Plus } from "@phosphor-icons/react"
import { TerminalManager } from "../terminal/terminal-manager"
import { useStore } from "../store"
import { findPaneById } from "../lib/pane-tree"
import { displaySessionTitle, shellType } from "../lib/session-label"
import { statusUi } from "../lib/status-ui"
import { newSurfaceKey } from "../lib/platform"
import { resolveDefaultShell } from "../lib/shells"
import type { PaneLeaf } from "../types"

/** A pane: a strip of terminal tabs (surfaces) + a mount point for the visible one.
 *  Terminals live in TerminalManager, so switching surfaces re-attaches (no respawn). */
export function TerminalPane({ pane, tabId }: { pane: PaneLeaf; tabId: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null)
  const activeId = pane.activeSessionId
  const surfaces = useStore(useShallow((s) => pane.sessionIds.map((id) => s.sessions[id])))
  const home = useStore((s) => s.home)
  const session = surfaces[pane.sessionIds.indexOf(activeId)]
  const focused = useStore(
    (s) =>
      s.activeTabId === tabId && s.tabs.find((t) => t.id === tabId)?.activeSessionId === activeId,
  )
  const status = session?.status ?? "idle"
  // The focus/attention top rail only disambiguates between panes — pointless when
  // the tab has a single pane, so suppress it there.
  const isSplit = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId)
    return tab ? tab.root.type === "split" : false
  })
  const multi = pane.sessionIds.length > 1

  // The visible surface read at event time (the render closure can be a frame stale).
  const visibleNow = () => {
    const tab = useStore.getState().tabs.find((t) => t.id === tabId)
    return (tab && findPaneById(tab.root, pane.id)?.activeSessionId) ?? activeId
  }

  // Header actions act on THIS pane: focus it first, then split / add a surface.
  const split = (direction: "row" | "column") => {
    const store = useStore.getState()
    store.setActivePane(tabId, visibleNow())
    store.splitActive(direction)
  }
  const addSurface = () => {
    const store = useStore.getState()
    store.setActivePane(tabId, visibleNow())
    // Same fallback as ⌘T / the palette: a shell no longer listed still gets a terminal.
    store.newSurface(resolveDefaultShell(store.shells, store.settings.defaultShell))
  }

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const s = useStore.getState().sessions[activeId]
    if (!s) return
    TerminalManager.attach(s, el)
    const ro = new ResizeObserver(() => {
      TerminalManager.fit(activeId)
      // This pane's hidden surfaces can't measure themselves — they take its grid.
      const tab = useStore.getState().tabs.find((t) => t.id === tabId)
      const self = tab && findPaneById(tab.root, pane.id)
      if (self) TerminalManager.syncHiddenSizes(self)
    })
    ro.observe(el)
    // Do NOT dispose — the terminal (and its PTY) survives being hidden behind another
    // surface or unmounted; disposal happens when the session leaves the store.
    return () => {
      ro.disconnect()
      TerminalManager.detach(activeId, el)
    }
  }, [activeId, pane.id, tabId])

  // Hidden surfaces still run: spawn/reattach their PTY (status, notifications, cwd)
  // without mounting them — e.g. after a restore or renderer reload.
  const idsKey = pane.sessionIds.join(" ")
  useEffect(() => {
    const sessions = useStore.getState().sessions
    for (const id of pane.sessionIds) {
      const s = sessions[id]
      if (s && id !== activeId) TerminalManager.ensureRunning(s, activeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, activeId])

  // Keep the visible surface's tab in view when the strip overflows (e.g. after ⌘T).
  useEffect(() => {
    stripRef.current
      ?.querySelector(".surface-tab.active")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeId, idsKey])

  const railClass = !isSplit ? "" : focused ? " focused" : status === "attention" ? " waiting" : ""

  // Right-click clipboard menu. Copy is disabled without a selection.
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    useStore.getState().setActivePane(tabId, activeId)
    setMenu({ x: e.clientX, y: e.clientY, hasSel: TerminalManager.hasSelection(activeId) })
  }
  const runMenu = (fn: () => void) => {
    fn()
    setMenu(null)
    TerminalManager.focus(activeId)
  }

  return (
    <div
      className={`terminal-pane${railClass}`}
      onMouseDown={() => useStore.getState().setActivePane(tabId, visibleNow())}
      // Re-focus the terminal after any click/selection so keystrokes reach the
      // PTY (the textarea doesn't always keep focus after a selection).
      onMouseUp={() => TerminalManager.focus(visibleNow())}
      onContextMenu={openMenu}
    >
      <div className="pane-header">
        <div
          className="surface-tabs"
          role="tablist"
          ref={stripRef}
          // A plain mouse wheel scrolls vertically; map it onto the horizontal strip.
          onWheel={(e) => {
            if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
          {pane.sessionIds.map((id, i) => {
            const s = surfaces[i]
            const active = id === activeId
            const ui = statusUi(s?.status ?? "idle")
            return (
              <div
                key={id}
                role="tab"
                aria-selected={active}
                className={`surface-tab${active ? " active" : ""}${multi ? " multi" : ""}`}
                title={displaySessionTitle(s, home)}
                // Left-click selects; the pane's onMouseUp then focuses the new terminal.
                onMouseDown={(e) => {
                  if (e.button === 0) useStore.getState().setActivePane(tabId, id)
                }}
                // No clipboard menu on a tab — it would target the visible surface, not this one.
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                // Middle-click closes a surface (browser convention).
                onAuxClick={(e) => {
                  if (e.button === 1 && multi) useStore.getState().closeSurface(tabId, id)
                }}
              >
                <Terminal
                  size={13}
                  weight="fill"
                  color={active && focused ? "var(--accent)" : "var(--dim)"}
                />
                <span className="pane-title">{displaySessionTitle(s, home)}</span>
                {/* Hidden surfaces surface their state on the tab (you can't see the pane). */}
                {/* Static dot (no pulse): don't animate compositing next to a WebGL canvas. */}
                {!active && s && s.status !== "idle" && <span className={`dot ${ui.dot}`} />}
                {multi && (
                  <button
                    className="surface-close"
                    title="Close terminal"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      if (e.button === 0) useStore.getState().closeSurface(tabId, id)
                    }}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <span className="pane-badge">{shellType(session?.command ?? "")}</span>
        <div className="pane-header-spacer" />
        <button
          className="iconbtn"
          style={{ width: 22, height: 22 }}
          title={`New terminal (${newSurfaceKey})`}
          onMouseDown={(e) => {
            e.stopPropagation()
            if (e.button === 0) addSurface()
          }}
        >
          <Plus size={13} />
        </button>
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
            // preventDefault: the mousedown's default focus-the-button would otherwise run
            // AFTER the dialog focuses its confirm button, breaking Enter + the Tab trap.
            e.preventDefault()
            if (e.button === 0) useStore.getState().requestClosePane(tabId, pane.id)
          }}
        >
          <X size={13} />
        </button>
      </div>
      <div className="terminal-mount" ref={mountRef} />
      {menu && (
        <>
          <div
            className="ctx-backdrop"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              className="ctx-item"
              disabled={!menu.hasSel}
              onMouseDown={(e) => {
                e.preventDefault()
                runMenu(() => TerminalManager.copySelection(activeId))
              }}
            >
              Copy
            </button>
            <button
              className="ctx-item"
              onMouseDown={(e) => {
                e.preventDefault()
                runMenu(() => TerminalManager.paste(activeId))
              }}
            >
              Paste
            </button>
            <button
              className="ctx-item"
              onMouseDown={(e) => {
                e.preventDefault()
                runMenu(() => TerminalManager.selectAll(activeId))
              }}
            >
              Select all
            </button>
          </div>
        </>
      )}
    </div>
  )
}
