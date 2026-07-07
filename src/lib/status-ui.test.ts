import { describe, it, expect } from "vitest"
import { statusUi } from "./status-ui"

describe("statusUi", () => {
  it("maps working → running (accent, pulsing)", () => {
    expect(statusUi("working")).toEqual({ dot: "accent", word: "running", pulse: true })
  })
  it("maps attention → waiting (amber, static)", () => {
    expect(statusUi("attention")).toEqual({ dot: "amber", word: "waiting", pulse: false })
  })
  it("maps idle → idle (faint, static)", () => {
    expect(statusUi("idle")).toEqual({ dot: "faint", word: "idle", pulse: false })
  })
})
