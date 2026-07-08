import type { Session, Tab } from "../types"

/** A tab's display title: the manual pin (tab.title) if set, else the focused
 *  pane's live title (from OSC), else a generic fallback. */
export function tabTitle(tab: Tab, sessions: Record<string, Session>): string {
  return tab.title.trim() || sessions[tab.activeSessionId]?.title || "shell"
}

/** Home-relative, compact cwd for sublines (…/a/b tail, "~" for $HOME). */
export function shortCwd(cwd: string | undefined, home: string): string {
  if (!cwd) return ""
  return home && (cwd === home || cwd.startsWith(home + "/")) ? "~" + cwd.slice(home.length) : cwd
}

/** "branch • ~/dir" (branch optional) for a session's subline. */
export function sessionSubline(cwd: string | undefined, home: string, branch?: string): string {
  const dir = shortCwd(cwd, home)
  if (branch && dir) return `${branch} • ${dir}`
  return branch || dir
}
