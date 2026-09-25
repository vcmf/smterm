// Quit without racing node-pty: its exit callback runs on a background thread and calls back
// into JS; if that lands while Electron is tearing Node down, node-pty throws a C++ exception
// nobody catches → abort() (SIGABRT crash report on ⌘Q). So quitting waits for every PTY's
// exit first — bounded, so a stuck child can never block the quit.

/** What draining needs from a PTY: a way to signal it and a promise of its exit. */
export interface Drainable {
  kill: (signal?: string) => void
  exited: Promise<void>
  killed?: boolean // already hung up (a closed pane winding down): wait, don't re-signal
}

export interface DrainOptions {
  graceMs?: number // wait after the hang-up before forcing
  forceMs?: number // wait after SIGKILL
  signals?: boolean // false on Windows: no signals (a queued SIGKILL would throw later)
  settleMs?: number // extra wait after the exits (Windows: ConPTY's native callback trails 'exit')
}

/** Resolves true if every exit settled within `ms`, else false (never rejects). */
function allWithin(ps: Promise<void>[], ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((res) => (timer = setTimeout(() => res(false), ms)))
  return Promise.race([Promise.all(ps).then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  )
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** Hang up every PTY, wait for the exits, SIGKILL stragglers; always resolves (true = clean). */
export async function drainPtys(
  ptys: Drainable[],
  { graceMs = 1500, forceMs = 500, signals = true, settleMs = 0 }: DrainOptions = {},
): Promise<boolean> {
  if (ptys.length === 0) return true
  const alive = new Set(ptys)
  for (const p of ptys) void p.exited.then(() => alive.delete(p))
  for (const p of ptys) {
    if (p.killed) continue
    try {
      p.kill() // SIGHUP: the shell (and a Claude inside it) shuts down normally
    } catch {
      // Already gone, or a half-closed handle: keep waiting on its exit all the same — a
      // failed kill doesn't prove its exit callback has run.
    }
  }
  let clean = await allWithin(
    [...alive].map((p) => p.exited),
    graceMs,
  )
  if (!clean && signals) {
    for (const p of alive) {
      try {
        p.kill("SIGKILL")
      } catch {
        // already gone
      }
    }
    clean = await allWithin(
      [...alive].map((p) => p.exited),
      forceMs,
    )
  }
  if (settleMs) await sleep(settleMs)
  return clean
}
