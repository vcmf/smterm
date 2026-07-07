import { describe, it, expect } from "vitest"
import { ligatureRanges } from "./ligatures"

describe("ligatureRanges", () => {
  it("finds a single ligature", () => {
    expect(ligatureRanges("a -> b")).toEqual([[2, 4]])
    expect(ligatureRanges("x == y")).toEqual([[2, 4]])
  })

  it("prefers the longest match", () => {
    expect(ligatureRanges("==>")).toEqual([[0, 3]])
    expect(ligatureRanges("===")).toEqual([[0, 3]])
  })

  it("finds multiple non-overlapping ligatures", () => {
    expect(ligatureRanges("a->b->c")).toEqual([
      [1, 3],
      [4, 6],
    ])
  })

  it("returns nothing when there are no ligatures", () => {
    expect(ligatureRanges("no ligatures here")).toEqual([])
    expect(ligatureRanges("")).toEqual([])
  })
})
