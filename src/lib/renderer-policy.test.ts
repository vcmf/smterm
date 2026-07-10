import { describe, it, expect } from "vitest"
import { webglPanes } from "./renderer-policy"

describe("webglPanes", () => {
  const three = ["a", "b", "c"]

  it("dom mode: no pane gets a context", () => {
    expect(webglPanes("dom", three, "a").size).toBe(0)
  })

  it("auto mode: exactly the focused visible pane", () => {
    expect([...webglPanes("auto", three, "b")]).toEqual(["b"])
  })

  it("auto mode: falls back to the first visible pane when focus isn't on-screen", () => {
    expect([...webglPanes("auto", three, "zzz")]).toEqual(["a"])
    expect([...webglPanes("auto", three, null)]).toEqual(["a"])
  })

  it("auto mode: nothing visible → no context", () => {
    expect(webglPanes("auto", [], "a").size).toBe(0)
  })

  it("never grants more than one context", () => {
    expect(webglPanes("auto", three, "a").size).toBe(1)
  })
})
