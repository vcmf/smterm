import { describe, it, expect } from "vitest"
import { gridChanged } from "./resize"

describe("gridChanged", () => {
  it("is true when there's no prior grid", () => {
    expect(gridChanged(undefined, 80, 24)).toBe(true)
  })

  it("is false when cols and rows are unchanged (skip the spurious SIGWINCH)", () => {
    expect(gridChanged({ cols: 80, rows: 24 }, 80, 24)).toBe(false)
  })

  it("is true when either dimension changes", () => {
    expect(gridChanged({ cols: 80, rows: 24 }, 100, 24)).toBe(true)
    expect(gridChanged({ cols: 80, rows: 24 }, 80, 30)).toBe(true)
  })
})
