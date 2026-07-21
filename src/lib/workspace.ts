import type { PaneNode, Session, Tab } from "../types"
import { clampPanelWidth } from "./right-panel"

// Persisted workspace (VS Code-style layout restore). We save the layout +
// enough to respawn each pane's shell in its last directory — NOT live process
// state (scrollback / running programs are lost; a fresh shell is spawned).

const VERSION = 1

interface PersistedSession {
  id: string
  title: string
  command: string
  args: string[]
  cwd?: string
}

interface PersistedTab {
  id: string
  title: string
  root: PaneNode
  activeSessionId: string
}

export interface PersistedWorkspace {
  version: number
  activeTabId: string | null
  tabs: PersistedTab[]
  sessions: PersistedSession[]
  rightPanelWidth?: number
}

export interface WorkspaceState {
  sessions: Record<string, Session>
  tabs: Tab[]
  activeTabId: string | null
  rightPanelWidth?: number
}

/** Snapshot the store's layout into the persistable shape (drops runtime status). */
export function serializeWorkspace(state: WorkspaceState): PersistedWorkspace {
  return {
    version: VERSION,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      root: t.root,
      activeSessionId: t.activeSessionId,
    })),
    sessions: Object.values(state.sessions).map((s) => ({
      id: s.id,
      title: s.title,
      command: s.command,
      args: s.args,
      cwd: s.cwd,
    })),
    ...(state.rightPanelWidth !== undefined ? { rightPanelWidth: state.rightPanelWidth } : {}),
  }
}

/** Rebuild store state from a parsed workspace; null if malformed/empty. */
export function deserializeWorkspace(input: unknown): WorkspaceState | null {
  if (!input || typeof input !== "object") return null
  const w = input as Partial<PersistedWorkspace>
  if (!Array.isArray(w.tabs) || !Array.isArray(w.sessions) || w.tabs.length === 0) return null

  const sessions: Record<string, Session> = {}
  for (const p of w.sessions) {
    if (!p || typeof p.id !== "string") return null
    sessions[p.id] = {
      id: p.id,
      title: typeof p.title === "string" ? p.title : "shell",
      command: typeof p.command === "string" ? p.command : "",
      args: Array.isArray(p.args) ? p.args : [],
      status: "idle",
      unread: false,
      cwd: typeof p.cwd === "string" ? p.cwd : undefined,
    }
  }

  const tabs: Tab[] = []
  for (const t of w.tabs) {
    if (!t || typeof t.id !== "string" || !t.root || typeof t.activeSessionId !== "string") {
      return null
    }
    tabs.push({
      id: t.id,
      title: typeof t.title === "string" ? t.title : "shell",
      root: t.root,
      activeSessionId: t.activeSessionId,
    })
  }

  const activeTabId =
    typeof w.activeTabId === "string" && tabs.some((t) => t.id === w.activeTabId)
      ? w.activeTabId
      : (tabs[0]?.id ?? null)

  const rightPanelWidth =
    typeof w.rightPanelWidth === "number" ? clampPanelWidth(w.rightPanelWidth) : undefined

  return { sessions, tabs, activeTabId, rightPanelWidth }
}

/** Parse the raw workspace.json file, tolerant of bad/empty content. */
export function parseWorkspace(raw: string): WorkspaceState | null {
  if (!raw.trim()) return null
  try {
    return deserializeWorkspace(JSON.parse(raw))
  } catch {
    return null
  }
}

export function serializeToJson(state: WorkspaceState): string {
  return `${JSON.stringify(serializeWorkspace(state), null, 2)}\n`
}
