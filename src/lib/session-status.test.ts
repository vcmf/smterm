import { describe, it, expect } from "vitest"
import { aggregateBadge, initialSignals, reduceSignals } from "./session-status"
import type { Signals } from "./session-status"

describe("reduceSignals", () => {
  it("command-start → working; command-end → idle", () => {
    const working = reduceSignals(initialSignals, { type: "command-start" }, true)
    expect(working.status).toBe("working")
    expect(reduceSignals(working, { type: "command-end" }, true).status).toBe("idle")
  })

  it("marks unread only when not visible", () => {
    expect(reduceSignals(initialSignals, { type: "output" }, true).unread).toBe(false)
    expect(reduceSignals(initialSignals, { type: "output" }, false).unread).toBe(true)
    expect(reduceSignals(initialSignals, { type: "command-end" }, false).unread).toBe(true)
  })

  it("attention raises status+unread only when not visible", () => {
    expect(reduceSignals(initialSignals, { type: "attention" }, false)).toEqual({
      status: "attention",
      unread: true,
    })
    // visible → no attention badge (user is already looking)
    expect(reduceSignals(initialSignals, { type: "attention" }, true)).toEqual(initialSignals)
  })

  it("reveal clears unread and downgrades attention to idle, but keeps working", () => {
    const attn: Signals = { status: "attention", unread: true }
    expect(reduceSignals(attn, { type: "reveal" }, true)).toEqual({
      status: "idle",
      unread: false,
    })
    const busy: Signals = { status: "working", unread: true }
    expect(reduceSignals(busy, { type: "reveal" }, true)).toEqual({
      status: "working",
      unread: false,
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
