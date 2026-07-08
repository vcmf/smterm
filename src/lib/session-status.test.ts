import { describe, it, expect } from "vitest"
import { aggregateBadge, initialSignals, reduceSignals } from "./session-status"
import type { Signals } from "./session-status"

describe("reduceSignals", () => {
  it("command-start → working (running); command-end → idle (not running)", () => {
    const working = reduceSignals(initialSignals, { type: "command-start" }, true)
    expect(working).toMatchObject({ status: "working", running: true })
    expect(reduceSignals(working, { type: "command-end" }, true)).toMatchObject({
      status: "idle",
      running: false,
    })
  })

  it("marks unread only when not visible", () => {
    expect(reduceSignals(initialSignals, { type: "output" }, true).unread).toBe(false)
    expect(reduceSignals(initialSignals, { type: "output" }, false).unread).toBe(true)
    expect(reduceSignals(initialSignals, { type: "command-end" }, false).unread).toBe(true)
  })

  it("attention raises status+unread only when not visible", () => {
    expect(reduceSignals(initialSignals, { type: "attention" }, false)).toMatchObject({
      status: "attention",
      unread: true,
    })
    // visible → no attention badge (user is already looking)
    expect(reduceSignals(initialSignals, { type: "attention" }, true)).toEqual(initialSignals)
  })

  it("output-idle flips a hidden RUNNING session to attention, never the focused one", () => {
    const busy: Signals = { status: "working", unread: false, running: true }
    expect(reduceSignals(busy, { type: "output-idle" }, false).status).toBe("attention")
    expect(reduceSignals(busy, { type: "output-idle" }, true)).toEqual(busy) // focused → untouched
    // not running / fresh idle → untouched by the idle timer
    expect(reduceSignals(initialSignals, { type: "output-idle" }, false)).toEqual(initialSignals)
    const notRunning: Signals = { status: "working", unread: false, running: false }
    expect(reduceSignals(notRunning, { type: "output-idle" }, false)).toEqual(notRunning)
  })

  it("output keeps a running agent working (even from idle) but never wakes a fresh prompt", () => {
    const runningQuiet: Signals = { status: "idle", unread: false, running: true }
    expect(reduceSignals(runningQuiet, { type: "output" }, true).status).toBe("working") // key fix
    const attn: Signals = { status: "attention", unread: false, running: false }
    expect(reduceSignals(attn, { type: "output" }, true).status).toBe("working") // resume
    expect(reduceSignals(initialSignals, { type: "output" }, true).status).toBe("idle") // stays idle
  })

  it("reveal clears attention → working if still running, else idle", () => {
    const runningAttn: Signals = { status: "attention", unread: true, running: true }
    expect(reduceSignals(runningAttn, { type: "reveal" }, true)).toEqual({
      status: "working",
      unread: false,
      running: true,
    })
    const doneAttn: Signals = { status: "attention", unread: true, running: false }
    expect(reduceSignals(doneAttn, { type: "reveal" }, true)).toEqual({
      status: "idle",
      unread: false,
      running: false,
    })
  })
})

describe("aggregateBadge", () => {
  it("prioritises attention > working > unread > none", () => {
    expect(aggregateBadge([])).toBeNull()
    expect(aggregateBadge([{ status: "idle", unread: false }])).toBeNull()
    expect(aggregateBadge([{ status: "idle", unread: true }])).toBe("unread")
    expect(
      aggregateBadge([
        { status: "working", unread: false },
        { status: "idle", unread: true },
      ]),
    ).toBe("working")
    expect(
      aggregateBadge([
        { status: "working", unread: true },
        { status: "attention", unread: true },
      ]),
    ).toBe("attention")
  })
})
