import { describe, it, expect } from "vitest"
import { hasImageFormat } from "./clipboard-image"

describe("hasImageFormat", () => {
  it("detects a raster image alongside text", () => {
    expect(hasImageFormat(["text/plain", "image/png"])).toBe(true)
    expect(hasImageFormat(["image/bmp"])).toBe(true)
  })
  it("ignores svg (markup, not a decodable bitmap — parity with readImage)", () => {
    expect(hasImageFormat(["image/svg+xml"])).toBe(false)
    expect(hasImageFormat(["text/plain", "image/svg+xml"])).toBe(false)
  })
  it("false for text-only / empty (main then falls back to readImage anyway)", () => {
    expect(hasImageFormat(["text/plain"])).toBe(false)
    expect(hasImageFormat([])).toBe(false)
  })
})
