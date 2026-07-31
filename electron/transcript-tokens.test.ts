import { describe, it, expect } from "vitest"
import { addLine, parseUsageChunk, addUsage, emptyUsage } from "./transcript-tokens"

const asst = (u: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", usage: u } })

describe("addLine", () => {
  it("adds an assistant line's usage", () => {
    const u = addLine(emptyUsage, asst({ input_tokens: 10, output_tokens: 5 }))
    expect(u).toEqual({ input: 10, output: 5, cacheCreate: 0, cacheRead: 0 })
  })

  it("sums cache fields", () => {
    const u = addLine(
      emptyUsage,
      asst({
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      }),
    )
    expect(u).toEqual({ input: 1, output: 2, cacheCreate: 3, cacheRead: 4 })
  })

  it("ignores non-assistant, malformed, and empty lines", () => {
    expect(addLine(emptyUsage, JSON.stringify({ type: "user", message: {} }))).toEqual(emptyUsage)
    expect(addLine(emptyUsage, "{not json")).toEqual(emptyUsage)
    expect(addLine(emptyUsage, "")).toEqual(emptyUsage)
    expect(addLine(emptyUsage, JSON.stringify({ type: "assistant", message: null }))).toEqual(
      emptyUsage,
    )
  })
})

describe("parseUsageChunk", () => {
  it("sums complete lines and reports bytes consumed, leaving a partial tail", () => {
    const a = asst({ input_tokens: 10, output_tokens: 1 })
    const b = asst({ input_tokens: 20, output_tokens: 2 })
    const partial = '{"type":"assistant","message":{"usage":{"input_'
    const chunk = `${a}\n${b}\n${partial}`
    const { usage, consumed } = parseUsageChunk(chunk)
    expect(usage).toEqual({ input: 30, output: 3, cacheCreate: 0, cacheRead: 0 })
    // consumed stops after the second newline — the partial line is left for next time.
    expect(consumed).toBe(Buffer.byteLength(`${a}\n${b}\n`))
  })

  it("consumes nothing when there is no complete line yet", () => {
    expect(parseUsageChunk('{"type":"assis')).toEqual({ usage: emptyUsage, consumed: 0 })
  })

  it("measures consumed in bytes for multibyte content", () => {
    const line = JSON.stringify({ type: "user", message: { text: "café €" } })
    const { consumed } = parseUsageChunk(`${line}\n`)
    expect(consumed).toBe(Buffer.byteLength(`${line}\n`))
    expect(consumed).toBeGreaterThan(`${line}\n`.length) // bytes > chars (é, €)
  })
})

describe("addUsage", () => {
  it("adds field-wise", () => {
    expect(addUsage({ input: 1, output: 2, cacheCreate: 3, cacheRead: 4 }, emptyUsage)).toEqual({
      input: 1,
      output: 2,
      cacheCreate: 3,
      cacheRead: 4,
    })
  })
})
