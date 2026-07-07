import { useStore } from "../store"

/** The working directory of the focused session (drives the git diff panel). */
export function useActiveCwd(): string | undefined {
  return useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    const sid = tab?.activeSessionId
    return sid ? s.sessions[sid]?.cwd : undefined
  })
}
