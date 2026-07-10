import { useStore } from "../store"
import { wslContext, type WslContext } from "./wsl"

/** The working directory of the focused session (drives the git diff panel). */
export function useActiveCwd(): string | undefined {
  return useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    const sid = tab?.activeSessionId
    return sid ? s.sessions[sid]?.cwd : undefined
  })
}

/** Non-reactive: the focused session's WSL context (so git runs inside the distro),
 *  or undefined for a native shell. Read at git-call time — it tracks the same
 *  session as the cwd, so it needn't be a reactive dependency. */
export function getActiveWsl(): WslContext | undefined {
  const s = useStore.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  const sess = tab?.activeSessionId ? s.sessions[tab.activeSessionId] : undefined
  return sess ? wslContext(sess.command, sess.args) : undefined
}
