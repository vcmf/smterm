import { describe, it, expect } from "vitest"
import { luminance, colorfgbg } from "./color"

describe("luminance", () => {
  it("is 0 for black, 1 for white", () => {
    expect(luminance("#000000")).toBe(0)
    expect(luminance("#ffffff")).toBeCloseTo(1)
  })

  it("weights green most (BT.709)", () => {
    // pure green is brighter than pure red than pure blue
    expect(luminance("#00ff00")!).toBeGreaterThan(luminance("#ff0000")!)
    expect(luminance("#ff0000")!).toBeGreaterThan(luminance("#0000ff")!)
  })

  it("expands 3-digit hex and tolerates missing #", () => {
    expect(luminance("#fff")).toBeCloseTo(1)
    expect(luminance("000000")).toBe(0)
  })

  it("returns null for non-hex input", () => {
    expect(luminance("rgba(0,0,0,0.5)")).toBeNull()
    expect(luminance("#12")).toBeNull()
    expect(luminance("")).toBeNull()
  })
})

describe("colorfgbg", () => {
  it("classifies our dark theme backgrounds as dark → 15;0", () => {
    for (const bg of ["#0b0b0d", "#1a1b26", "#1e1e2e", "#1d2021"]) {
      expect(colorfgbg(bg)).toBe("15;0")
    }
  })

  it("classifies a light background as light → 0;15", () => {
    expect(colorfgbg("#ffffff")).toBe("0;15")
    expect(colorfgbg("#fdf6e3")).toBe("0;15") // solarized light
  })

  it("returns null for an unparseable colour so the var stays unset", () => {
    expect(colorfgbg("transparent")).toBeNull()
  })
})
