import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OutputCoalescer } from "./coalescer"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("OutputCoalescer", () => {
  it("batches several chunks into one flush on the timer", () => {
    const out: string[] = []
    const c = new OutputCoalescer(4, 1000, (d) => out.push(d))
    c.push("a")
    c.push("b")
    c.push("c")
    expect(out).toEqual([]) // nothing sent yet
    vi.advanceTimersByTime(4)
    expect(out).toEqual(["abc"]) // one message, order preserved
  })

  it("flushes immediately when the size cap is exceeded", () => {
    const out: string[] = []
    const c = new OutputCoalescer(100, 5, (d) => out.push(d))
    c.push("abc")
    c.push("def") // total 6 ≥ 5 → flush now
    expect(out).toEqual(["abcdef"])
    expect(vi.getTimerCount()).toBe(0) // timer cleared
  })

  it("starts a fresh window after a flush", () => {
    const out: string[] = []
    const c = new OutputCoalescer(4, 1000, (d) => out.push(d))
    c.push("x")
    vi.advanceTimersByTime(4)
    c.push("y")
    vi.advanceTimersByTime(4)
    expect(out).toEqual(["x", "y"])
  })

  it("manual flush sends buffered data once; empty flush is a no-op", () => {
    const out: string[] = []
    const c = new OutputCoalescer(4, 1000, (d) => out.push(d))
    c.push("hi")
    c.flush()
    c.flush() // nothing buffered
    expect(out).toEqual(["hi"])
  })

  it("dispose drops buffered output and the pending timer", () => {
    const out: string[] = []
    const c = new OutputCoalescer(4, 1000, (d) => out.push(d))
    c.push("lost")
    c.dispose()
    vi.advanceTimersByTime(10)
    expect(out).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("reset drops pending output but the coalescer stays usable", () => {
    const out: string[] = []
    const c = new OutputCoalescer(4, 1000, (d) => out.push(d))
    c.push("dropme")
    c.reset() // drop pending (already replayed from the OutputBuffer)
    vi.advanceTimersByTime(10)
    expect(out).toEqual([]) // nothing from before reset
    c.push("live")
    vi.advanceTimersByTime(4)
    expect(out).toEqual(["live"]) // still batching after reset
  })
})
