import { describe, it, expect } from "vitest"
import { compareVersions, isNewer } from "./version"

describe("compareVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareVersions("0.1.25", "0.1.24")).toBe(1)
    expect(compareVersions("0.2.0", "0.1.99")).toBe(1)
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1)
    expect(compareVersions("0.1.24", "0.1.24")).toBe(0)
    expect(compareVersions("0.1.23", "0.1.24")).toBe(-1)
  })

  it("treats a final release as newer than its prereleases", () => {
    expect(compareVersions("0.1.0", "0.1.0-rc.9")).toBe(1)
    expect(compareVersions("0.1.0-rc.9", "0.1.0")).toBe(-1)
  })

  it("orders prereleases numerically then by identifier", () => {
    expect(compareVersions("0.1.0-rc.10", "0.1.0-rc.9")).toBe(1)
    expect(compareVersions("0.1.0-beta", "0.1.0-alpha")).toBe(1)
    expect(compareVersions("0.1.0-rc.1", "0.1.0-rc.1")).toBe(0)
  })

  it("tolerates a leading v and stray build suffix", () => {
    expect(compareVersions("v0.1.25", "0.1.24")).toBe(1)
    expect(compareVersions("0.1.25+build.7", "0.1.24")).toBe(1)
  })

  it("compares equal (no false update) on unparseable input", () => {
    expect(compareVersions("garbage", "0.1.0")).toBe(0)
    expect(compareVersions("0.1.0", "")).toBe(0)
  })
})

describe("isNewer", () => {
  it("is true only when latest strictly exceeds current", () => {
    expect(isNewer("0.1.25", "0.1.24")).toBe(true)
    expect(isNewer("0.1.24", "0.1.24")).toBe(false)
    expect(isNewer("0.1.23", "0.1.24")).toBe(false)
    expect(isNewer("0.1.0-rc.1", "0.1.0")).toBe(false) // prerelease isn't "newer" than final
  })
})
