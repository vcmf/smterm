import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { addLine, addUsage, emptyUsage, TranscriptTokens } from "./transcript-tokens"

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

describe("TranscriptTokens", () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "smterm-tt-"))
    file = path.join(dir, "t.jsonl")
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("sums a whole transcript", async () => {
    fs.writeFileSync(file, `${asst({ input_tokens: 10, output_tokens: 4 })}\n`)
    const t = new TranscriptTokens()
    expect(await t.update(file)).toEqual({ input: 10, output: 4, cacheCreate: 0, cacheRead: 0 })
  })

  it("reads incrementally — only new bytes fold into the running total", async () => {
    const t = new TranscriptTokens()
    fs.writeFileSync(file, `${asst({ input_tokens: 10, output_tokens: 1 })}\n`)
    expect((await t.update(file)).input).toBe(10)
    fs.appendFileSync(file, `${asst({ input_tokens: 20, output_tokens: 2 })}\n`)
    expect(await t.update(file)).toEqual({ input: 30, output: 3, cacheCreate: 0, cacheRead: 0 })
  })

  it("leaves a partial (not-yet-newline-terminated) trailing line for next time", async () => {
    const t = new TranscriptTokens()
    fs.writeFileSync(
      file,
      `${asst({ input_tokens: 5, output_tokens: 1 })}\n${asst({ input_tokens: 99, output_tokens: 9 })}`,
    )
    expect((await t.update(file)).input).toBe(5) // second line has no newline yet → not counted
    fs.appendFileSync(file, "\n") // now it's complete
    expect((await t.update(file)).input).toBe(104)
  })

  it("is correct with a tiny chunk size that splits lines across reads", async () => {
    // chunkBytes=8 forces many slices mid-line; carry-across-chunks must still sum exactly.
    const lines = [
      asst({ input_tokens: 100, output_tokens: 10 }),
      asst({ input_tokens: 200, output_tokens: 20 }),
      asst({ input_tokens: 300, output_tokens: 30 }),
    ]
    fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(""))
    const t = new TranscriptTokens(8)
    expect(await t.update(file)).toEqual({ input: 600, output: 60, cacheCreate: 0, cacheRead: 0 })
  })

  it("keeps the byte offset exact across multibyte content with a tiny chunk size", async () => {
    const t = new TranscriptTokens(4)
    // A multibyte line first (must not corrupt the offset), then a usage line.
    fs.writeFileSync(file, `${JSON.stringify({ type: "user", message: { t: "café €🚀" } })}\n`)
    expect(await t.update(file)).toEqual(emptyUsage)
    fs.appendFileSync(file, `${asst({ input_tokens: 7, output_tokens: 3 })}\n`)
    expect(await t.update(file)).toEqual({ input: 7, output: 3, cacheCreate: 0, cacheRead: 0 })
  })

  it("returns empty for a missing file (best-effort, no throw)", async () => {
    expect(await new TranscriptTokens().update(path.join(dir, "nope.jsonl"))).toEqual(emptyUsage)
  })

  it("re-sums from the start if the file shrank (rotation/truncation)", async () => {
    const t = new TranscriptTokens()
    fs.writeFileSync(file, `${asst({ input_tokens: 50, output_tokens: 5 })}\n`)
    expect((await t.update(file)).input).toBe(50)
    fs.writeFileSync(file, `${asst({ input_tokens: 8, output_tokens: 1 })}\n`) // smaller → reset
    expect(await t.update(file)).toEqual({ input: 8, output: 1, cacheCreate: 0, cacheRead: 0 })
  })

  it("reads the first reachable candidate (WSL UNC-share fallback shape)", async () => {
    fs.writeFileSync(file, `${asst({ input_tokens: 9, output_tokens: 2 })}\n`)
    const t = new TranscriptTokens()
    expect((await t.update("/linux/like", ["/no/such", file])).input).toBe(9)
  })
})
