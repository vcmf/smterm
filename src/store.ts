import { create } from "zustand"
import type { PaneNode, Session, ShellOption, Tab } from "./types"
import { allSessionIds, firstSessionId, makeLeaf, removeNode, splitNode } from "./lib/pane-tree"
import { reduceSignals } from "./lib/session-status"
import type { SignalEvent } from "./lib/session-status"
import { defaultSettings } from "./settings/schema"
import type { Settings } from "./settings/schema"
import type { GitStatus } from "./lib/ipc"

const newId = () => crypto.randomUUID()

function makeSession(shell: ShellOption): Session {
  return {
    id: newId(),
    title: shell.label,
    command: shell.command,
    args: shell.args,
    status: "idle",
    unread: false,
  }
}

interface AppState {
  sessions: Record<string, Session>
  tabs: Tab[]
  activeTabId: string | null
  shells: ShellOption[]
  windowFocused: boolean
  settings: Settings
  settingsOpen: boolean
  paletteOpen: boolean
  diffPanelOpen: boolean
  git: GitStatus | null

  setGit: (git: GitStatus | null) => void
  setDiffPanelOpen: (open: boolean) => void
  setSessionCwd: (sessionId: string, cwd: string) => void
  setPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSettings: (settings: Settings) => void
  setShells: (shells: ShellOption[]) => void
  newTab: (shell: ShellOption) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  renameTab: (tabId: string, title: string) => void
  splitActive: (direction: "row" | "column", shell: ShellOption) => void
  closePane: (tabId: string, sessionId: string) => void
  setActivePane: (tabId: string, sessionId: string) => void
  setWindowFocused: (focused: boolean) => void
  signalSession: (sessionId: string, ev: SignalEvent) => void
  revealTab: (tabId: string) => void
}

/** Whether a session is currently on-screen (window focused + in the active tab). */
export function isVisibleIn(state: AppState, sessionId: string): boolean {
  if (!state.windowFocused || !state.activeTabId) return false
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  return tab ? allSessionIds(tab.root).includes(sessionId) : false
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
  diffPanelOpen: false,
  git: null,

  setGit: (git) => set({ git }),
  setDiffPanelOpen: (diffPanelOpen) => set({ diffPanelOpen }),
  setSessionCwd: (sessionId, cwd) =>
    set((state) => {
      const s = state.sessions[sessionId]
      if (!s || s.cwd === cwd) return {}
      return { sessions: { ...state.sessions, [sessionId]: { ...s, cwd } } }
    }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettings: (settings) => set({ settings }),
  setShells: (shells) => set({ shells }),

  newTab: (shell) =>
    set((state) => {
      const session = makeSession(shell)
      const tab: Tab = {
        id: newId(),
        title: shell.label,
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

  splitActive: (direction, shell) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeTabId)
      if (!tab) return {}
      const session = makeSession(shell)
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
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activeSessionId: sessionId } : t)),
    })),

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
        { status: session.status, unread: session.unread },
        ev,
        isVisibleIn(state, sessionId),
      )
      if (next.status === session.status && next.unread === session.unread) return {}
      return { sessions: { ...state.sessions, [sessionId]: { ...session, ...next } } }
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
        const status = s.status === "attention" ? "idle" : s.status
        if (s.unread || status !== s.status) {
          sessions[id] = { ...s, status, unread: false }
          changed = true
        }
      }
      return changed ? { sessions } : {}
    }),
}))
