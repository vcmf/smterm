import { describe, it, expect } from "vitest"
import { webglPanes } from "./renderer-policy"

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
