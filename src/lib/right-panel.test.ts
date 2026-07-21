import { describe, it, expect } from "vitest"
import {
  clampPanelWidth,
  RIGHT_PANEL_MIN,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_DEFAULT,
} from "./right-panel"

describe("clampPanelWidth", () => {
  it("passes through a value in range", () => {
    expect(clampPanelWidth(420)).toBe(420)
  })
  it("clamps below the min and above the max", () => {
    expect(clampPanelWidth(100)).toBe(RIGHT_PANEL_MIN)
    expect(clampPanelWidth(9999)).toBe(RIGHT_PANEL_MAX)
  })
  it("respects a tighter maxAvail (e.g. 60% of a small window)", () => {
    expect(clampPanelWidth(700, 500)).toBe(500)
    expect(clampPanelWidth(900, 2000)).toBe(RIGHT_PANEL_MAX) // never exceeds the absolute cap
  })
  it("rounds fractional pointer positions", () => {
    expect(clampPanelWidth(420.7)).toBe(421)
  })
  it("falls back to the default for non-finite input", () => {
    expect(clampPanelWidth(NaN)).toBe(RIGHT_PANEL_DEFAULT)
    expect(clampPanelWidth(Infinity)).toBe(RIGHT_PANEL_DEFAULT)
  })
})
