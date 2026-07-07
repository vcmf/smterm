import { useEffect } from "react"
import { ipc } from "./lib/ipc"
import { TopBar } from "./components/top-bar"
import { Sidebar } from "./components/sidebar"
import { StatusBar } from "./components/status-bar"
import { CommandPalette } from "./components/command-palette"
import { DiffPanel } from "./components/diff-panel"
import { PaneLayout } from "./components/pane-layout"
import { SettingsPanel } from "./components/settings-panel"
import { useActiveCwd } from "./lib/use-active-cwd"
import { TerminalManager } from "./terminal/terminal-manager"
import { useStore } from "./store"
import { ensureNotificationPermission } from "./lib/notify"
import { loadSettings } from "./settings/io"
import { applyThemeVars, getTheme } from "./settings/themes"
import type { ShellOption } from "./types"
import "@xterm/xterm/css/xterm.css"
import "./App.css"

function App() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const settings = useStore((s) => s.settings)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const diffPanelOpen = useStore((s) => s.diffPanelOpen)
  const activeCwd = useActiveCwd()

  // Load available shells once, then open the first tab.
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
      if (store.tabs.length === 0 && shells[0]) store.newTab(shells[0])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load settings.json, and re-load whenever the file changes (GUI or hand-edit).
  useEffect(() => {
    void (async () => {
      useStore.getState().setSettings(await loadSettings())
    })()
    const unlisten = ipc.onSettingsChanged(async () => {
      useStore.getState().setSettings(await loadSettings())
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

  // Dispose terminals whose sessions have left the store (pane/tab closed).
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      const current = new Set(Object.keys(state.sessions))
      for (const id of Object.keys(prev.sessions)) {
        if (!current.has(id)) TerminalManager.dispose(id)
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
      void ipc.gitStatus(activeCwd).then((g) => {
        if (!cancelled) useStore.getState().setGit(g)
      })
    poll()
    const t = setInterval(poll, 2500)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [activeCwd])

  // Global ⌘K / Ctrl-K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
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
        <Sidebar />
        <div className="content">
          {activeTab ? (
            <PaneLayout key={activeTab.id} node={activeTab.root} tabId={activeTab.id} />
          ) : (
            <div className="empty">No sessions — open a tab.</div>
          )}
        </div>
        {diffPanelOpen && <DiffPanel />}
      </div>
      <StatusBar />
      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsPanel />}
    </div>
  )
}

export default App
