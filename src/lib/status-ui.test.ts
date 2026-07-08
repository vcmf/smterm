import { describe, it, expect } from "vitest"
import { statusUi } from "./status-ui"

describe("statusUi", () => {
  it("maps working → running (accent, pulsing)", () => {
    expect(statusUi("working")).toEqual({ dot: "accent", word: "running", pulse: true })
  })
  it("maps attention → needs input (amber, static)", () => {
    expect(statusUi("attention")).toEqual({ dot: "amber", word: "needs input", pulse: false })
  })
  it("maps idle → idle (faint, static)", () => {
    expect(statusUi("idle")).toEqual({ dot: "faint", word: "idle", pulse: false })
  })
})
