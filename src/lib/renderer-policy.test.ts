import { describe, it, expect } from "vitest"
import { webglPanes, shouldRebuildAtlas } from "./renderer-policy"

describe("webglPanes", () => {
  const three = ["a", "b", "c"]

  it("webgl mode: every visible pane gets a context", () => {
    expect([...webglPanes("webgl", three)].sort()).toEqual(["a", "b", "c"])
  })

  it("webgl mode: nothing visible → no context", () => {
    expect(webglPanes("webgl", []).size).toBe(0)
  })

  it("dom mode: no pane gets a context", () => {
    expect(webglPanes("dom", three).size).toBe(0)
  })
})

describe("shouldRebuildAtlas", () => {
  it("rebuilds when a context was created and more than one now coexists", () => {
    expect(shouldRebuildAtlas(true, 2)).toBe(true)
    expect(shouldRebuildAtlas(true, 4)).toBe(true)
  })

  it("skips when only one context exists (nothing to corrupt)", () => {
    expect(shouldRebuildAtlas(true, 1)).toBe(false)
  })

  it("skips when nothing was created (no disturbance)", () => {
    expect(shouldRebuildAtlas(false, 3)).toBe(false)
    expect(shouldRebuildAtlas(false, 0)).toBe(false)
  })
})
