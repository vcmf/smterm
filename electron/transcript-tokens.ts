// Token accounting from Claude Code transcripts. Hooks don't carry token counts, but
// every hook payload references a transcript JSONL whose assistant lines each embed a
// `message.usage` block. We sum those — incrementally (only the bytes appended since the
// last read) so a growing multi-MB transcript never costs more than the new turn. Pure
// parsing here (tested); the thin fs slice-read + offset bookkeeping lives in the tracker.

import fs from "node:fs"
import type { TokenUsage } from "../src/lib/agent-graph"

export type { TokenUsage }

export const emptyUsage: TokenUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** Add one transcript line's usage into `acc` (pure). Non-assistant / unparseable lines
 *  are ignored, so a partial or malformed tail line is simply a no-op. */
export function addLine(acc: TokenUsage, line: string): TokenUsage {
  const t = line.trim()
  if (!t) return acc
  let o: unknown
  try {
    o = JSON.parse(t)
  } catch {
    return acc
  }
  if (typeof o !== "object" || o === null) return acc
  const rec = o as { type?: unknown; message?: unknown }
  if (rec.type !== "assistant" || typeof rec.message !== "object" || rec.message === null)
    return acc
  const u = (rec.message as { usage?: unknown }).usage
  if (typeof u !== "object" || u === null) return acc
  const g = u as Record<string, unknown>
  return {
    input: acc.input + num(g.input_tokens),
    output: acc.output + num(g.output_tokens),
    cacheCreate: acc.cacheCreate + num(g.cache_creation_input_tokens),
    cacheRead: acc.cacheRead + num(g.cache_read_input_tokens),
  }
}

/** Sum usage over the COMPLETE lines in `chunk` (everything up to the last newline) and
 *  report how many bytes were consumed, so the caller can advance its offset and leave a
 *  partial trailing line for next time. Pure. */
export function parseUsageChunk(chunk: string): { usage: TokenUsage; consumed: number } {
  const lastNl = chunk.lastIndexOf("\n")
  if (lastNl < 0) return { usage: emptyUsage, consumed: 0 }
  const complete = chunk.slice(0, lastNl)
  let usage = emptyUsage
  for (const line of complete.split("\n")) usage = addLine(usage, line)
  // consumed is a byte count; transcripts are UTF-8 and JSONL content is overwhelmingly
  // ASCII, but measure in bytes to keep the file offset exact for multibyte lines.
  return { usage, consumed: Buffer.byteLength(chunk.slice(0, lastNl + 1)) }
}

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheCreate: a.cacheCreate + b.cacheCreate,
  cacheRead: a.cacheRead + b.cacheRead,
})

/** Incremental per-transcript token accumulator. Keeps a byte offset + running total per
 *  file; each update reads only the newly-appended bytes. Lives in the main process, off
 *  the terminal hot path — see startAgentObservability. */
export class TranscriptTokens {
  private state = new Map<string, { offset: number; usage: TokenUsage }>()
  // Per-path promise chain: serialize reads of the same transcript so two overlapping
  // updates can't read the same offset twice and double-count the appended bytes.
  private chains = new Map<string, Promise<TokenUsage>>()

  /** Read new bytes of `path`, fold their usage in, and return the cumulative total. Reads
   *  of the same path are serialized; any fs error yields the prior total (best-effort). */
  update(path: string): Promise<TokenUsage> {
    const next = (this.chains.get(path) ?? Promise.resolve(emptyUsage))
      .catch(() => emptyUsage)
      .then(() => this.readOnce(path))
    this.chains.set(path, next)
    return next
  }

  private async readOnce(path: string): Promise<TokenUsage> {
    const prev = this.state.get(path) ?? { offset: 0, usage: emptyUsage }
    let handle: fs.promises.FileHandle | undefined
    try {
      const st = await fs.promises.stat(path)
      // Rotated/truncated (or a different file at this path) → re-sum from the start.
      const from = st.size < prev.offset ? 0 : prev.offset
      const base = from === 0 ? emptyUsage : prev.usage
      if (st.size <= from) {
        const usage = base
        this.state.set(path, { offset: from, usage })
        return usage
      }
      handle = await fs.promises.open(path, "r")
      const len = st.size - from
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await handle.read(buf, 0, len, from)
      const { usage: delta, consumed } = parseUsageChunk(buf.toString("utf8", 0, bytesRead))
      const usage = addUsage(base, delta)
      this.state.set(path, { offset: from + consumed, usage })
      return usage
    } catch {
      return prev.usage
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  /** Forget a transcript's accumulated state (e.g. on SessionEnd) to bound memory. */
  forget(path: string): void {
    this.state.delete(path)
    this.chains.delete(path)
  }
}
