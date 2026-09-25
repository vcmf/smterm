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

  it("a PTY whose kill throws (already gone) doesn't hold the others up", async () => {
    vi.useFakeTimers()
    const gone: Drainable = {
      exited: new Promise(() => {}),
      kill: () => {
        throw new Error("x")
      },
    }
    const ok = fakePty(5)
    const done = drainPtys([gone, ok], { graceMs: 100 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await done).toBe(true)
  })

  it("nothing to drain → resolves immediately", async () => {
    expect(await drainPtys([])).toBe(true)
  })
})
