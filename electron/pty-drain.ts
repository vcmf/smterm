// Quit without racing node-pty: its exit callback runs on a background thread and calls back
// into JS; if that lands while Electron is tearing Node down, node-pty throws a C++ exception
// nobody catches → abort() (SIGABRT crash report on ⌘Q). So quitting waits for every PTY's
// exit first — bounded, so a stuck child can never block the quit.

/** What draining needs from a PTY: a way to signal it and a promise of its exit. */
export interface Drainable {
  kill: (signal?: string) => void
  exited: Promise<void>
}

const settled = (p: Promise<void>) => p.then(() => true)

/** Resolves true if every exit settled within `ms`, else false (never rejects). */
function allWithin(ps: Promise<void>[], ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((res) => (timer = setTimeout(() => res(false), ms)))
  return Promise.race([Promise.all(ps.map(settled)).then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  )
}

/** Hang up every PTY and wait for the exits; after `graceMs` SIGKILL whatever is left and
 *  wait `forceMs` more. Always resolves — true = all exited cleanly in time. */
export async function drainPtys(
  ptys: Drainable[],
  { graceMs = 1500, forceMs = 500 } = {},
): Promise<boolean> {
  if (ptys.length === 0) return true
  const alive = new Set(ptys)
  for (const p of ptys) void p.exited.then(() => alive.delete(p))
  for (const p of ptys) {
    try {
      p.kill() // SIGHUP: the shell (and a Claude inside it) shuts down normally
    } catch {
      alive.delete(p) // already gone
    }
  }
  if (
    await allWithin(
      [...alive].map((p) => p.exited),
      graceMs,
    )
  )
    return true
  for (const p of alive) {
    try {
      p.kill("SIGKILL") // unix; Windows has no signals (ConPTY kill is already forceful)
    } catch {
      // already gone / unsupported
    }
  }
  return allWithin(
    [...alive].map((p) => p.exited),
    forceMs,
  )
}
