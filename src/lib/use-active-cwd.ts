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

/** The focused session's id (keys the per-pane Files-panel root override). */
export function useActiveSessionId(): string | undefined {
  return useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.activeSessionId)
}

/** The Files-panel root for the focused pane: the per-session override if set, else the
 *  live cwd. `diverged` = an override that no longer matches the terminal's cwd (drives
 *  the amber reset button). `sessionId` is needed to set/clear the override. */
export function useFilesRoot(): {
  root: string | undefined
  cwd: string | undefined
  sessionId: string | undefined
  diverged: boolean
} {
  const cwd = useActiveCwd()
  const sessionId = useActiveSessionId()
  const override = useStore((s) => (sessionId ? s.paneRoot[sessionId] : undefined))
  return { root: override ?? cwd, cwd, sessionId, diverged: !!override && override !== cwd }
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
