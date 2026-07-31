import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TranscriptTokens } from "./transcript-tokens"
import { tokenEventsForBatch } from "./agent-tokens"

const asst = (u: Record<string, number>) =>
  `${JSON.stringify({ type: "assistant", message: { role: "assistant", usage: u } })}\n`

describe("tokenEventsForBatch", () => {
  let dir: string
  const sessionTx = () => path.join(dir, "session.jsonl")
  const agentTx = () => path.join(dir, "agent.jsonl")

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "smterm-tok-"))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("prices a Stop against the session root", async () => {
    fs.writeFileSync(sessionTx(), asst({ input_tokens: 100, output_tokens: 40 }))
    const out = await tokenEventsForBatch(new TranscriptTokens(), [
      { event: "Stop", sessionId: "s", transcriptPath: sessionTx() },
    ])
    expect(out).toEqual([
      {
        event: "TokenUsage",
        sessionId: "s",
        tokens: { input: 100, output: 40, cacheCreate: 0, cacheRead: 0 },
      },
    ])
  })

  it("prices a SubagentStop against the sub-agent's own transcript", async () => {
    fs.writeFileSync(agentTx(), asst({ input_tokens: 5, output_tokens: 3 }))
    const out = await tokenEventsForBatch(new TranscriptTokens(), [
      { event: "SubagentStop", sessionId: "s", agentId: "a1", agentTranscriptPath: agentTx() },
    ])
    expect(out).toEqual([
      {
        event: "TokenUsage",
        sessionId: "s",
        agentId: "a1",
        tokens: { input: 5, output: 3, cacheCreate: 0, cacheRead: 0 },
      },
    ])
  })

  it("accumulates across turns incrementally (only new bytes each time)", async () => {
    const tracker = new TranscriptTokens()
    fs.writeFileSync(sessionTx(), asst({ input_tokens: 10, output_tokens: 1 }))
    const first = await tokenEventsForBatch(tracker, [
      { event: "Stop", sessionId: "s", transcriptPath: sessionTx() },
    ])
    expect(first[0]!.tokens!.input).toBe(10)

    // Append a second turn; the next read should fold it onto the running total.
    fs.appendFileSync(sessionTx(), asst({ input_tokens: 20, output_tokens: 2 }))
    const second = await tokenEventsForBatch(tracker, [
      { event: "Stop", sessionId: "s", transcriptPath: sessionTx() },
    ])
    expect(second[0]!.tokens).toEqual({ input: 30, output: 3, cacheCreate: 0, cacheRead: 0 })
  })

  it("reads through the resolver's candidates (the WSL Linux→UNC translation seam)", async () => {
    fs.writeFileSync(sessionTx(), asst({ input_tokens: 7, output_tokens: 8 }))
    // The agent reported a Linux-style path; resolve maps it to [unreachable, real host path].
    const reported = "/home/me/.claude/projects/x/s.jsonl"
    const resolve = (p: string) => (p === reported ? ["/no/such/unc", sessionTx()] : [p])
    const out = await tokenEventsForBatch(
      new TranscriptTokens(),
      [{ event: "Stop", sessionId: "s", transcriptPath: reported }],
      resolve,
    )
    expect(out[0]!.tokens).toEqual({ input: 7, output: 8, cacheCreate: 0, cacheRead: 0 })
  })

  it("emits a zeroed total when no candidate is reachable (graceful, no throw)", async () => {
    const out = await tokenEventsForBatch(
      new TranscriptTokens(),
      [{ event: "Stop", sessionId: "s", transcriptPath: "/gone.jsonl" }],
      () => ["/still/gone.jsonl"],
    )
    expect(out[0]!.tokens).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 })
  })

  it("emits nothing for events without a transcript, and SessionEnd frees state", async () => {
    const tracker = new TranscriptTokens()
    const out = await tokenEventsForBatch(tracker, [
      { event: "UserPromptSubmit", sessionId: "s" },
      { event: "SessionEnd", sessionId: "s", transcriptPath: sessionTx() },
    ])
    expect(out).toEqual([])
  })
})
