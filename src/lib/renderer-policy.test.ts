import { describe, it, expect } from "vitest"
import { shouldUseWebgl, MAX_WEBGL_PANES } from "./renderer-policy"

describe("shouldUseWebgl", () => {
  it("uses WebGL for a normal number of visible panes", () => {
    expect(shouldUseWebgl(1)).toBe(true)
    expect(shouldUseWebgl(MAX_WEBGL_PANES)).toBe(true)
  })
  it("falls back to DOM when too many panes are visible at once", () => {
    expect(shouldUseWebgl(MAX_WEBGL_PANES + 1)).toBe(false)
  })
  it("uses DOM when nothing is visible", () => {
    expect(shouldUseWebgl(0)).toBe(false)
  })
})
