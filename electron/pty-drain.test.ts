import { describe, it, expect, vi, afterEach } from "vitest"
import { drainPtys, type Drainable } from "./pty-drain"

// A fake PTY: exits `afterMs` after the signal it responds to (null = ignores it).
function fakePty(onHup: number | null, onKill: number | null = 0) {
  let exit!: () => void
  const exited = new Promise<void>((r) => (exit = r))
  const signals: string[] = []
  const p: Drainable & { signals: string[] } = {
    signals,
    exited,
    kill: (sig = "SIGHUP") => {
      signals.push(sig)
      const ms = sig === "SIGKILL" ? onKill : onHup
      if (ms !== null) setTimeout(exit, ms)
    },
  }
  return p
}

describe("drainPtys", () => {
  afterEach(() => vi.useRealTimers())

  it("hangs up every PTY and resolves once all have exited", async () => {
    vi.useFakeTimers()
    const a = fakePty(10)
    const b = fakePty(50)
    const done = drainPtys([a, b])
    await vi.advanceTimersByTimeAsync(60)
    expect(await done).toBe(true)
    expect(a.signals).toEqual(["SIGHUP"])
    expect(b.signals).toEqual(["SIGHUP"])
  })

  it("SIGKILLs a PTY that ignores the hang-up, after the grace period", async () => {
    vi.useFakeTimers()
    const stubborn = fakePty(null, 5)
    const done = drainPtys([stubborn], { graceMs: 100, forceMs: 50 })
    await vi.advanceTimersByTimeAsync(99)
    expect(stubborn.signals).toEqual(["SIGHUP"])
    await vi.advanceTimersByTimeAsync(10)
    expect(stubborn.signals).toEqual(["SIGHUP", "SIGKILL"])
    await vi.advanceTimersByTimeAsync(10)
    expect(await done).toBe(true)
  })

  it("never blocks the quit: resolves false when even SIGKILL doesn't end it", async () => {
    vi.useFakeTimers()
    const zombie = fakePty(null, null)
    const done = drainPtys([zombie], { graceMs: 100, forceMs: 50 })
    await vi.advanceTimersByTimeAsync(200)
    expect(await done).toBe(false)
  })

  it("a failed kill still waits for that PTY's exit (its callback may be pending)", async () => {
    vi.useFakeTimers()
    let exit!: () => void
    const halfClosed: Drainable = {
      exited: new Promise((r) => (exit = r)),
      kill: () => {
        throw new Error("handle closed")
      },
    }
    let done = false
    void drainPtys([halfClosed], { graceMs: 100 }).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(20)
    expect(done).toBe(false) // still waiting on it
    exit()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it("Windows: no signals (a queued SIGKILL would throw later), then a settle wait", async () => {
    vi.useFakeTimers()
    const p = fakePty(null)
    let result: boolean | undefined
    void drainPtys([p], { graceMs: 100, signals: false, settleMs: 300 }).then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(150)
    expect(p.signals).toEqual(["SIGHUP"]) // never SIGKILL
    expect(result).toBeUndefined() // settling
    await vi.advanceTimersByTimeAsync(300)
    expect(result).toBe(false)
  })

  it("a PTY already hung up (closed pane) is waited for, not signalled again", async () => {
    vi.useFakeTimers()
    const signals: string[] = []
    let exit!: () => void
    const closing: Drainable = {
      killed: true,
      exited: new Promise((r) => (exit = r)),
      kill: (sig = "SIGHUP") => void signals.push(sig),
    }
    setTimeout(() => exit(), 30) // its own shutdown finishes
    let done = false
    void drainPtys([closing], { graceMs: 100 }).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(30)
    expect(done).toBe(true)
    expect(signals).toEqual([])
  })

  it("nothing to drain → resolves immediately", async () => {
    expect(await drainPtys([])).toBe(true)
  })
})
