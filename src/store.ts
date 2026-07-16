import { create } from "zustand"
import type { PaneNode, Session, ShellOption, Tab } from "./types"
import { allSessionIds, firstSessionId, makeLeaf, removeNode, splitNode } from "./lib/pane-tree"
import { inheritShell } from "./lib/shells"
import { reduceSignals } from "./lib/session-status"
import type { SignalEvent } from "./lib/session-status"
import { reduceAgentEvent, emptyGraph } from "./lib/agent-graph"
import type { AgentEvent, AgentGraph } from "./lib/agent-graph"
import { defaultSettings } from "./settings/schema"
import type { Settings } from "./settings/schema"
import type { GitStatus } from "./lib/ipc"
import type { EditorInfo } from "./lib/file-actions"
import type { WorkspaceState } from "./lib/workspace"

const newId = () => crypto.randomUUID()

function makeSession(shell: ShellOption, initialCwd?: string): Session {
  return {
    id: newId(),
    title: shell.label,
    command: shell.command,
    args: shell.args,
    status: "idle",
    unread: false,
    cwd: initialCwd,
  }
}

/** The cwd of the currently focused terminal, if known — new panes/tabs inherit it. */
function focusedCwd(state: AppState): string | undefined {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const sid = tab?.activeSessionId
  return sid ? state.sessions[sid]?.cwd : undefined
}

/** The single right-side panel's active view (null = hidden). Files / Changes / Agents
 *  share one panel — the top-bar icons switch it (click the active one to hide). */
export type RightView = "files" | "changes" | "agents" | null

interface AppState {
  sessions: Record<string, Session>
  tabs: Tab[]
  activeTabId: string | null
  shells: ShellOption[]
  windowFocused: boolean
  settings: Settings
  settingsOpen: boolean
  paletteOpen: boolean
  searchOpen: boolean
  rightView: RightView // which view the single right-side panel shows (null = hidden)
  sidebarCollapsed: boolean
  git: GitStatus | null
  agents: AgentGraph // live tree of Claude agents/sub-agents (M6, fed by hook events)
  home: string
  platform: string // process.platform ("darwin"|"win32"|"linux"); "" until fetched
  editor: EditorInfo | null // configured editor availability (file context menu)
  preview: { abs: string; name: string } | null // file open in the preview popup (null = closed)
  paneRoot: Record<string, string> // per-session Files-panel root override (absent = follow cwd)

  setHome: (home: string) => void
  setPlatform: (platform: string) => void
  setEditor: (editor: EditorInfo) => void
  setPreview: (preview: { abs: string; name: string } | null) => void
  setPaneRoot: (sessionId: string, root: string) => void
  clearPaneRoot: (sessionId: string) => void
  setSessionOscTitle: (sessionId: string, title: string) => void
  setGit: (git: GitStatus | null) => void
  applyAgentEvents: (events: AgentEvent[]) => void
  setRightView: (view: RightView) => void
  setSessionCwd: (sessionId: string, cwd: string) => void
  setPaletteOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSettings: (settings: Settings) => void
  setShells: (shells: ShellOption[]) => void
  restoreWorkspace: (ws: WorkspaceState) => void
  newTab: (shell: ShellOption) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  renameTab: (tabId: string, title: string) => void
  splitActive: (direction: "row" | "column", fallback?: ShellOption) => void
  closePane: (tabId: string, sessionId: string) => void
  setActivePane: (tabId: string, sessionId: string) => void
  focusSession: (sessionId: string) => void
  setWindowFocused: (focused: boolean) => void
  signalSession: (sessionId: string, ev: SignalEvent) => void
  revealTab: (tabId: string) => void
}

/** Whether the user is actively looking at this exact session: window focused +
 *  it's the active tab's focused pane. Per-pane, so the heuristic never nags (and
 *  we don't badge) the pane you're driving. */
export function isVisibleIn(state: AppState, sessionId: string): boolean {
  if (!state.windowFocused || !state.activeTabId) return false
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab?.activeSessionId === sessionId
}

/** Mark a session as seen: drop attention/unread/reason. A still-running agent
 *  falls back to "working" (not idle) so it keeps reading as active. */
function seen(s: Session): Session {
  if (s.status !== "attention" && !s.unread && !s.detail) return s
  return {
    ...s,
    status: s.status === "attention" ? (s.running ? "working" : "idle") : s.status,
    unread: false,
    detail: undefined,
  }
}

export const isSessionVisible = (sessionId: string): boolean =>
  isVisibleIn(useStore.getState(), sessionId)

export const useStore = create<AppState>((set, get) => ({
  sessions: {},
  tabs: [],
  activeTabId: null,
  shells: [],
  windowFocused: true,
  settings: defaultSettings,
  settingsOpen: false,
  paletteOpen: false,
  searchOpen: false,
  rightView: null,
  sidebarCollapsed: false,
  git: null,
  agents: emptyGraph,
  home: "",
  platform: "",
  editor: null,
  preview: null,
  paneRoot: {},

  setHome: (home) => set({ home }),
  setPlatform: (platform) => set({ platform }),
  setEditor: (editor) => set({ editor }),
  setPreview: (preview) => set({ preview }),
  setPaneRoot: (sessionId, root) =>
    set((s) => ({ paneRoot: { ...s.paneRoot, [sessionId]: root } })),
  clearPaneRoot: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.paneRoot)) return {}
      const next = { ...s.paneRoot }
      delete next[sessionId]
      return { paneRoot: next }
    }),
  setSessionOscTitle: (sessionId, title) =>
    set((state) => {
      const s = state.sessions[sessionId]
      const next = title.trim()
      if (!s || !next || s.oscTitle === next) return {}
      return { sessions: { ...state.sessions, [sessionId]: { ...s, oscTitle: next } } }
    }),
  setGit: (git) => set({ git }),

  // Fold a coalesced batch of hook events into the agent tree (one re-render per batch).
  applyAgentEvents: (events) =>
    set((state) => ({ agents: events.reduce(reduceAgentEvent, state.agents) })),
  setRightView: (rightView) => set({ rightView }),
  setSessionCwd: (sessionId, cwd) =>
    set((state) => {
      const s = state.sessions[sessionId]
      if (!s || s.cwd === cwd) return {}
      return { sessions: { ...state.sessions, [sessionId]: { ...s, cwd } } }
    }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettings: (settings) => set({ settings }),
  setShells: (shells) => set({ shells }),

  restoreWorkspace: (ws) =>
    set({ sessions: ws.sessions, tabs: ws.tabs, activeTabId: ws.activeTabId }),

  newTab: (shell) =>
    set((state) => {
      const session = makeSession(shell, focusedCwd(state))
      const tab: Tab = {
        id: newId(),
        title: "", // unpinned — display derives from the focused pane's live title
        root: makeLeaf(session.id),
        activeSessionId: session.id,
      }
      return {
        sessions: { ...state.sessions, [session.id]: session },
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      }
    }),

  closeTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId)
      if (!tab) return {}
      const sessions = { ...state.sessions }
      for (const id of allSessionIds(tab.root)) delete sessions[id]
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      const activeTabId =
        state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId
      return { sessions, tabs, activeTabId }
    }),

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
    get().revealTab(tabId)
  },

  renameTab: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  splitActive: (direction, fallback) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab) return {}
      // Inherit the source pane's shell + cwd (WSL → WSL), not the list's first entry.
      const src = state.sessions[tab.activeSessionId]
      const shell = inheritShell(state.shells, src) ?? fallback
      if (!shell) return {}
      const session = makeSession(shell, src?.cwd)
      const root: PaneNode = splitNode(
        tab.root,
        tab.activeSessionId,
        direction,
        session.id,
        newId(),
      )
      return {
        sessions: { ...state.sessions, [session.id]: session },
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, root, activeSessionId: session.id } : t,
        ),
      }
    }),

  closePane: (tabId, sessionId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId)
      if (!tab) return {}
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      const root = removeNode(tab.root, sessionId)
      if (root === null) {
        const tabs = state.tabs.filter((t) => t.id !== tabId)
        const activeTabId =
          state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId
        return { sessions, tabs, activeTabId }
      }
      const activeSessionId =
        tab.activeSessionId === sessionId ? firstSessionId(root) : tab.activeSessionId
      return {
        sessions,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, root, activeSessionId } : t)),
      }
    }),

  setActivePane: (tabId, sessionId) =>
    set((state) => {
      const session = state.sessions[sessionId]
      return {
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activeSessionId: sessionId } : t)),
        // Focusing a pane = you've seen it: clear its attention/unread/reason.
        sessions: session ? { ...state.sessions, [sessionId]: seen(session) } : state.sessions,
      }
    }),

  // The terminal itself gained focus (click/keyboard) — make its pane active. This is
  // the authoritative focus signal: a click handler on the pane container misses clicks
  // inside a terminal that has mouse-tracking on (agent TUIs), because xterm's selection
  // service stopPropagation()s those mousedowns. Derives the tab from the session.
  focusSession: (sessionId) =>
    set((state) => {
      const tab = state.tabs.find((t) => allSessionIds(t.root).includes(sessionId))
      if (!tab) return {}
      const session = state.sessions[sessionId]
      return {
        activeTabId: tab.id,
        tabs: state.tabs.map((t) => (t.id === tab.id ? { ...t, activeSessionId: sessionId } : t)),
        sessions: session ? { ...state.sessions, [sessionId]: seen(session) } : state.sessions,
      }
    }),

  setWindowFocused: (focused) => {
    set({ windowFocused: focused })
    const { activeTabId, revealTab } = get()
    if (focused && activeTabId) revealTab(activeTabId)
  },

  signalSession: (sessionId, ev) =>
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return {}
      const next = reduceSignals(
        { status: session.status, unread: session.unread, running: session.running },
        ev,
        isVisibleIn(state, sessionId),
      )
      // The attention reason (OSC-9 message / "needs input"); cleared otherwise.
      const detail =
        next.status === "attention"
          ? ev.type === "attention"
            ? ev.detail || "needs input"
            : "needs input"
          : undefined
      if (
        next.status === session.status &&
        next.unread === session.unread &&
        next.running === session.running &&
        detail === session.detail
      ) {
        return {}
      }
      return { sessions: { ...state.sessions, [sessionId]: { ...session, ...next, detail } } }
    }),

  revealTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId)
      if (!tab) return {}
      const sessions = { ...state.sessions }
      let changed = false
      for (const id of allSessionIds(tab.root)) {
        const s = sessions[id]
        if (!s) continue
        const status = s.status === "attention" ? (s.running ? "working" : "idle") : s.status
        if (s.unread || status !== s.status || s.detail) {
          sessions[id] = { ...s, status, unread: false, detail: undefined }
          changed = true
        }
      }
      return changed ? { sessions } : {}
    }),
}))
