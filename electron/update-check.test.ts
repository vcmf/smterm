import { describe, it, expect } from "vitest"
import { parseRelease } from "./update-check"

describe("parseRelease", () => {
  it("pulls tag + html_url from a GitHub release payload", () => {
    expect(
      parseRelease({ tag_name: "v0.1.25", html_url: "https://x/releases/tag/v0.1.25" }),
    ).toEqual({
      tag: "v0.1.25",
      url: "https://x/releases/tag/v0.1.25",
    })
  })

  it("url is null when absent, but a tag still parses", () => {
    expect(parseRelease({ tag_name: "0.1.25" })).toEqual({ tag: "0.1.25", url: null })
  })

  it("returns null for non-release / missing tag payloads", () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease({ message: "Not Found" })).toBeNull()
    expect(parseRelease("nope")).toBeNull()
  })
})
