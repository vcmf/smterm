import { describe, it, expect } from "vitest"
import { dropZone, insertIndex } from "./drop-zone"

const rect = { left: 100, top: 50, width: 400, height: 200 } // x 100..500, y 50..250

describe("dropZone", () => {
  it("is the centre away from every edge band", () => {
    expect(dropZone(rect, 300, 150)).toBe("center")
  })

  it("picks the edge whose band the cursor is in", () => {
    expect(dropZone(rect, 110, 150)).toBe("left")
    expect(dropZone(rect, 490, 150)).toBe("right")
    expect(dropZone(rect, 300, 55)).toBe("top")
    expect(dropZone(rect, 300, 245)).toBe("bottom")
  })

  it("measures bands per axis, so a wide pane doesn't favour top/bottom", () => {
    // 20% across (inside the left band) but 40% down (outside top/bottom bands)
    expect(dropZone(rect, 180, 130)).toBe("left")
  })

  it("in a corner, the nearer edge (relative to its axis) wins", () => {
    // 5% from left, 10% from top → left
    expect(dropZone(rect, 120, 70)).toBe("left")
    // 15% from left, 2.5% from top → top
    expect(dropZone(rect, 160, 55)).toBe("top")
  })

  it("band boundary: exactly 25% in is the centre", () => {
    expect(dropZone(rect, 200, 150)).toBe("center")
  })

  it("a zero-size rect is the centre", () => {
    expect(dropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe("center")
  })
})

describe("insertIndex", () => {
  const tabs = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
  ]
  it("before a tab left of its midpoint, after it past the midpoint", () => {
    expect(insertIndex(tabs, 10)).toBe(0)
    expect(insertIndex(tabs, 60)).toBe(1)
    expect(insertIndex(tabs, 140)).toBe(1)
    expect(insertIndex(tabs, 160)).toBe(2)
  })
  it("past every tab (or none) → the end", () => {
    expect(insertIndex(tabs, 999)).toBe(2)
    expect(insertIndex([], 5)).toBe(0)
  })
})
