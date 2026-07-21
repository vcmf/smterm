import { useEffect } from "react"
import { ipc } from "./lib/ipc"
import { TopBar } from "./components/top-bar"
import { Sidebar } from "./components/sidebar"
import { StatusBar } from "./components/status-bar"
import { CommandPalette } from "./components/command-palette"
import { SearchBar } from "./components/search-bar"
import { DiffPanel } from "./components/diff-panel"
import { AgentsPanel } from "./components/agents-panel"
import { FilesPanel } from "./components/files-panel"
import { PaneLayout } from "./components/pane-layout"
import { SettingsPanel } from "./components/settings-panel"
import { FilePreview } from "./components/file-preview"
import { RightPanelResizer } from "./components/right-panel-resizer"
import { useActiveCwd, getActiveWsl } from "./lib/use-active-cwd"
import { TerminalManager } from "./terminal/terminal-manager"
import { useStore } from "./store"
import { ensureNotificationPermission } from "./lib/notify"
import { loadSettings } from "./settings/io"
import { applyThemeVars, getTheme } from "./settings/themes"
import { parseWorkspace, serializeToJson } from "./lib/workspace"
import type { ShellOption } from "./types"
import "@xterm/xterm/css/xterm.css"
import "./App.css"

function App() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const settings = useStore((s) => s.settings)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const searchOpen = useStore((s) => s.searchOpen)
  const rightView = useStore((s) => s.rightView)
  const rightPanelWidth = useStore((s) => s.rightPanelWidth)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const activeCwd = useActiveCwd()

  // Load shells, then restore the saved workspace (VS Code-style) or open a tab.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let shells: ShellOption[] = []
      try {
        shells = await ipc.listShells()
      } catch {
        // Running without a backend (e.g. plain browser) — fall through.
      }
      if (cancelled) return
      if (shells.length === 0) {
        shells = [{ id: "default", label: "shell", command: "", args: [] }]
      }
      const store = useStore.getState()
      store.setShells(shells)
      if (store.tabs.length === 0) {
        let restored = null
        try {
          restored = parseWorkspace(await ipc.readWorkspace())
        } catch {
          // no/invalid workspace — start fresh
        }
        if (cancelled) return
        if (restored) store.restoreWorkspace(restored)
        else if (shells[0]) store.newTab(shells[0])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the layout (debounced) so the next launch restores it. Skips writes
  // when only runtime status changed (serialized JSON is identical).
  useEffect(() => {
    let last = ""
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      const s = useStore.getState()
      const json = serializeToJson({
        sessions: s.sessions,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        rightPanelWidth: s.rightPanelWidth,
      })
      if (json === last) return
      last = json
      ipc.writeWorkspace(json)
    }
    const unsub = useStore.subscribe((state, prev) => {
      if (
        state.tabs !== prev.tabs ||
        state.sessions !== prev.sessions ||
        state.activeTabId !== prev.activeTabId ||
        state.rightPanelWidth !== prev.rightPanelWidth
      ) {
        clearTimeout(timer)
        timer = setTimeout(save, 600)
      }
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [])

  // Load settings.json, and re-load whenever the file changes (GUI or hand-edit).
  useEffect(() => {
    void (async () => {
      useStore.getState().setSettings(await loadSettings())
    })()
    const unlisten = ipc.onSettingsChanged(async () => {
      useStore.getState().setSettings(await loadSettings())
      void ipc.editorInfo().then((e) => useStore.getState().setEditor(e)) // openPath may have changed
    })
    return () => unlisten()
  }, [])

  // Agents board (M6): fold coalesced hook-event batches into the store's agent tree.
  useEffect(() => {
    const unlisten = ipc.onAgentEvents((events) => {
      useStore.getState().applyAgentEvents(events)
      if (import.meta.env.DEV) {
        const g = useStore.getState().agents
        const names = events.map((e) => e.event).join(", ")
        // console.log (Info level) so it isn't hidden by the devtools "Verbose" filter.
        console.log(
          `[agents] +${events.length} [${names}] → ${g.rootIds.length} session(s), ${Object.keys(g.nodes).length} node(s)`,
        )
      }
    })
    return () => unlisten()
  }, [])

  // Apply settings to CSS theme + all terminals whenever they change.
  useEffect(() => {
    applyThemeVars(getTheme(settings.theme))
    TerminalManager.applySettings(settings)
  }, [settings])

  // Notification permission + window focus tracking (drives focus-aware badges).
  useEffect(() => {
    void ensureNotificationPermission()
    const onFocus = () => useStore.getState().setWindowFocused(true)
    const onBlur = () => useStore.getState().setWindowFocused(false)
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  // WebGL repair: the GPU glyph atlas / framebuffer can go stale after the app is
  // backgrounded, the display scale / monitor (DPR) changes, or a resize — showing
  // garbled glyphs until a scroll forces a repaint. Automate that repaint on exactly
  // those events; rebuild the atlas when render metrics changed. See GOTCHAS #renderer.
  useEffect(() => {
    const repaint = () => TerminalManager.repairRenderers(false)
    const rebuild = () => TerminalManager.repairRenderers(true)
    const onVisible = () => {
      if (document.visibilityState === "visible") repaint()
    }
    let resizeTimer: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(rebuild, 200) // debounce: rebuild once the drag settles
    }
    // DPR change (monitor swap / OS display scaling / browser zoom) — the media
    // query is pinned to the current devicePixelRatio, so re-arm after each change.
    let dprMq: MediaQueryList | null = null
    const onDpr = () => {
      rebuild()
      armDpr()
    }
    const armDpr = () => {
      if (typeof window.matchMedia !== "function") return // absent in jsdom/tests
      dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprMq.addEventListener?.("change", onDpr, { once: true })
    }
    window.addEventListener("focus", repaint)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("resize", onResize)
    armDpr()
    return () => {
      window.removeEventListener("focus", repaint)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("resize", onResize)
      dprMq?.removeEventListener?.("change", onDpr)
      clearTimeout(resizeTimer)
    }
  }, [])

  // Dispose terminals whose sessions have left the store (pane/tab closed).
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      const current = new Set(Object.keys(state.sessions))
      for (const id of Object.keys(prev.sessions)) {
        if (!current.has(id)) TerminalManager.dispose(id)
      }
    })
  }, [])

  // Keep WebGL on only the on-screen panes: reconcile on tab switch / split /
  // close so background tabs release their GPU context and heavy splits use DOM.
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      if (state.activeTabId !== prev.activeTabId || state.tabs !== prev.tabs) {
        TerminalManager.reconcileRenderers()
      }
    })
  }, [])

  // Poll git status for the focused session's cwd (feeds status bar + diff panel).
  useEffect(() => {
    if (!activeCwd) {
      useStore.getState().setGit(null)
      return
    }
    let cancelled = false
    const poll = () =>
      void ipc.gitStatus(activeCwd, getActiveWsl()).then((g) => {
        if (!cancelled) useStore.getState().setGit(g)
      })
    poll()
    const t = setInterval(poll, 2500)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [activeCwd])

  // Cache $HOME + platform once (home-relative labels; OS-specific menu labels).
  useEffect(() => {
    void ipc.platformInfo().then((i) => {
      useStore.getState().setHome(i.home)
      useStore.getState().setPlatform(i.platform)
    })
    void ipc.editorInfo().then((e) => useStore.getState().setEditor(e))
  }, [])

  // Load-test mode (SMTERM_PERF=1): run the perf suite once, then report.
  useEffect(() => {
    void ipc.perfMode().then((on) => {
      if (on) void import("./lib/perf").then((m) => m.runPerfSuite())
    })
  }, [])

  // Global shortcuts: ⌘K/Ctrl-K = command palette; ⌘F (mac) / Ctrl+Shift+F = find.
  // Plain Ctrl+F is left for the shell (readline forward-char).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      } else if ((e.metaKey && k === "f") || (e.ctrlKey && e.shiftKey && k === "f")) {
        e.preventDefault()
        const s = useStore.getState()
        s.setSearchOpen(!s.searchOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        {!sidebarCollapsed && <Sidebar />}
        <div className="content">
          {activeTab ? (
            <PaneLayout key={activeTab.id} node={activeTab.root} tabId={activeTab.id} />
          ) : (
            <div className="empty">No sessions — open a tab.</div>
          )}
          {searchOpen && <SearchBar />}
        </div>
        {rightView && (
          <div className="rightpanel" style={{ width: rightPanelWidth }}>
            <RightPanelResizer />
            {rightView === "files" && <FilesPanel />}
            {rightView === "changes" && <DiffPanel />}
            {rightView === "agents" && <AgentsPanel />}
          </div>
        )}
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsPanel />}
      <FilePreview />
    </div>
  )
}

export default App
