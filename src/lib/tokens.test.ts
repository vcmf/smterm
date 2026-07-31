import { describe, it, expect } from "vitest"
import { headlineTokens, formatTokens, tokenBreakdown } from "./tokens"

describe("headlineTokens", () => {
  it("is input + cacheCreate + output, excluding the cheap cache_read", () => {
    expect(headlineTokens({ input: 100, output: 50, cacheCreate: 10, cacheRead: 99999 })).toBe(160)
  })
})

describe("formatTokens", () => {
  it("formats across magnitudes", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1200)).toBe("1.2k")
    expect(formatTokens(15000)).toBe("15k")
    expect(formatTokens(1_500_000)).toBe("1.5M")
    expect(formatTokens(42_000_000)).toBe("42M")
  })
})

describe("tokenBreakdown", () => {
  it("lays out out / in / cache", () => {
    expect(tokenBreakdown({ input: 3000, output: 1200, cacheCreate: 500, cacheRead: 20000 })).toBe(
      "↓ 1.2k out · ↑ 3.5k in · 21k cache", // cache = 500 + 20000 = 20.5k → 21k
    )
  })
})
