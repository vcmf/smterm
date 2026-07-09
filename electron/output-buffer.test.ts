import { describe, it, expect } from "vitest"
import { OutputBuffer } from "./output-buffer"

describe("OutputBuffer", () => {
  it("dumps everything pushed, in order, when under the cap", () => {
    const b = new OutputBuffer(1024)
    b.push("hello ")
    b.push("world")
    expect(b.dump()).toBe("hello world")
    expect(b.bytes).toBe(11)
  })

  it("ignores empty pushes", () => {
    const b = new OutputBuffer(1024)
    b.push("")
    expect(b.dump()).toBe("")
    expect(b.bytes).toBe(0)
  })

  it("drops oldest whole chunks once over the byte budget", () => {
    const b = new OutputBuffer(10)
    b.push("aaaaa") // 5
    b.push("bbbbb") // 10 (at cap)
    b.push("ccccc") // 15 → drop "aaaaa"
    expect(b.dump()).toBe("bbbbbccccc")
    expect(b.bytes).toBe(10)
  })

  it("keeps only the tail when a single chunk exceeds the whole budget", () => {
    const b = new OutputBuffer(4)
    b.push("abcdefgh") // 8 > 4 → keep last 4
    expect(b.dump()).toBe("efgh")
    expect(b.bytes).toBe(4)
  })

  it("never splits earlier chunks — retains at least the newest whole chunk", () => {
    const b = new OutputBuffer(3)
    b.push("aa")
    b.push("bb") // over cap, drop "aa", keep "bb" whole (2 ≤ 3)
    expect(b.dump()).toBe("bb")
    expect(b.bytes).toBe(2)
  })

  it("clear() empties the buffer", () => {
    const b = new OutputBuffer(1024)
    b.push("data")
    b.clear()
    expect(b.dump()).toBe("")
    expect(b.bytes).toBe(0)
  })
})
