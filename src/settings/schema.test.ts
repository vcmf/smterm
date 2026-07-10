import { describe, it, expect } from "vitest"
import { defaultSettings, mergeSettings, parseSettings, serializeSettings } from "./schema"

describe("mergeSettings", () => {
  it("returns defaults for empty/garbage input", () => {
    expect(mergeSettings({})).toEqual(defaultSettings)
    expect(mergeSettings(null)).toEqual(defaultSettings)
    expect(mergeSettings("nope")).toEqual(defaultSettings)
    expect(mergeSettings(42)).toEqual(defaultSettings)
  })

  it("merges a partial object over defaults", () => {
    const s = mergeSettings({ theme: "light", font: { size: 16 } })
    expect(s.theme).toBe("light")
    expect(s.font.size).toBe(16)
    expect(s.font.family).toBe(defaultSettings.font.family) // untouched
    expect(s.cursorBlink).toBe(defaultSettings.cursorBlink)
  })

  it("shareHistory defaults on and accepts an explicit opt-out", () => {
    expect(mergeSettings({}).shareHistory).toBe(true)
    expect(mergeSettings({ shareHistory: false }).shareHistory).toBe(false)
    expect(mergeSettings({ shareHistory: "no" }).shareHistory).toBe(true) // wrong type → default
  })

  it("shiftEnterNewline defaults on and accepts an opt-out", () => {
    expect(mergeSettings({}).shiftEnterNewline).toBe(true)
    expect(mergeSettings({ shiftEnterNewline: false }).shiftEnterNewline).toBe(false)
  })

  it("fileLinks defaults on; openPath defaults to the VS Code template and allows empty", () => {
    expect(mergeSettings({}).fileLinks).toBe(true)
    expect(mergeSettings({}).openPath).toBe("code -g {file}:{line}:{col}")
    expect(mergeSettings({ fileLinks: false }).fileLinks).toBe(false)
    expect(mergeSettings({ openPath: "" }).openPath).toBe("") // "" = OS default, not rejected
    expect(mergeSettings({ openPath: "cursor -g {file}:{line}" }).openPath).toBe(
      "cursor -g {file}:{line}",
    )
  })

  it("falls back per-field on wrong types", () => {
    const s = mergeSettings({ font: { size: "big", ligatures: "yes" }, scrollback: "lots" })
    expect(s.font.size).toBe(defaultSettings.font.size)
    expect(s.font.ligatures).toBe(defaultSettings.font.ligatures)
    expect(s.scrollback).toBe(defaultSettings.scrollback)
  })

  it("clamps numbers into range", () => {
    expect(mergeSettings({ font: { size: 9999 } }).font.size).toBe(72)
    expect(mergeSettings({ font: { size: 1 } }).font.size).toBe(6)
    expect(mergeSettings({ font: { lineHeight: 100 } }).font.lineHeight).toBe(3)
  })

  it("ignores unknown keys and empty strings", () => {
    const s = mergeSettings({ nope: true, theme: "   " })
    expect(s).not.toHaveProperty("nope")
    expect(s.theme).toBe(defaultSettings.theme)
  })
})

describe("parseSettings", () => {
  it("defaults on empty or invalid JSON", () => {
    expect(parseSettings("")).toEqual(defaultSettings)
    expect(parseSettings("   ")).toEqual(defaultSettings)
    expect(parseSettings("{ not json")).toEqual(defaultSettings)
  })

  it("round-trips through serialize", () => {
    const s = mergeSettings({ theme: "light", font: { size: 15 } })
    expect(parseSettings(serializeSettings(s))).toEqual(s)
  })
})
