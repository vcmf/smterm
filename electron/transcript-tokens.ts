// Token accounting from Claude Code transcripts. Hooks don't carry token counts, but every
// hook payload references a transcript JSONL whose assistant lines each embed a `message.usage`
// block. We sum those — incrementally (only the bytes appended since the last read) so a
// growing transcript never re-scans, and in bounded chunks that yield to the event loop so a
// large first read (e.g. a `claude --resume`d 30 MB+ file) can't stall PTY forwarding.
//
// NOTE (stability): Claude documents this JSONL as an INTERNAL format that may change between
// releases. This parse is deliberately best-effort — if `message.usage` is renamed/reshaped a
// future version simply yields 0 (no badge) rather than erroring. Revisit if Claude ships a
// supported token source (OTEL, or usage in the hook payload itself).

import fs from "node:fs"
import type { TokenUsage } from "../src/lib/agent-graph"

export type { TokenUsage }

export const emptyUsage: TokenUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** Add one transcript line's usage into `acc` (pure). Non-assistant / unparseable lines are
 *  ignored, so a partial or malformed tail line is simply a no-op. */
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

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheCreate: a.cacheCreate + b.cacheCreate,
  cacheRead: a.cacheRead + b.cacheRead,
})

const NL = 0x0a // '\n'
const DEFAULT_CHUNK = 1 << 20 // 1 MiB read+parse slices

/** Incremental per-transcript token accumulator. Keeps a byte offset + running total per file;
 *  each update reads only the newly-appended bytes, in chunks that yield between slices. Lives
 *  in the main process, off the terminal hot path — see startAgentObservability. */
export class TranscriptTokens {
  private state = new Map<string, { offset: number; usage: TokenUsage }>()
  // Per-key promise chain: serialize reads of the same transcript so two overlapping updates
  // can't read the same offset twice and double-count the appended bytes.
  private chains = new Map<string, Promise<TokenUsage>>()

  // chunkBytes is injectable so tests can force multi-chunk / line-boundary paths.
  constructor(private readonly chunkBytes: number = DEFAULT_CHUNK) {}

  /** Read new bytes of the transcript, fold their usage in, and return the cumulative total.
   *  `candidates` are try-in-order host paths for the same file (>1 only on WSL, where a Linux
   *  path resolves to distro UNC shares); accumulator state is keyed by `key` so it's stable
   *  regardless of which candidate wins. Reads of the same key are serialized; any fs error
   *  yields the prior total (best-effort). */
  update(key: string, candidates: string[] = [key]): Promise<TokenUsage> {
    const next = (this.chains.get(key) ?? Promise.resolve(emptyUsage))
      .catch(() => emptyUsage)
      .then(() => this.readOnce(key, candidates))
    this.chains.set(key, next)
    return next
  }

  private async readOnce(key: string, candidates: string[]): Promise<TokenUsage> {
    const prev = this.state.get(key) ?? { offset: 0, usage: emptyUsage }
    let handle: fs.promises.FileHandle | undefined
    try {
      // First candidate that exists on the host fs (WSL: the reachable UNC share).
      let target: string | undefined
      let st: fs.Stats | undefined
      for (const c of candidates) {
        try {
          st = await fs.promises.stat(c)
          target = c
          break
        } catch {
          // try the next candidate
        }
      }
      if (!target || !st) return prev.usage
      // Rotated/truncated (or a different file at this path) → re-sum from the start.
      const from = st.size < prev.offset ? 0 : prev.offset
      let usage = from === 0 ? emptyUsage : prev.usage
      if (st.size <= from) {
        this.state.set(key, { offset: from, usage })
        return usage
      }

      handle = await fs.promises.open(target, "r")
      // Read [from, size) in bounded chunks. `carry` holds bytes after the last newline (a
      // partial line) so we only ever decode COMPLETE lines — a line ends at '\n', a byte
      // boundary, so its bytes are valid UTF-8 and multibyte chars are never split.
      let pos = from
      let carry = Buffer.alloc(0)
      while (pos < st.size) {
        const len = Math.min(this.chunkBytes, st.size - pos)
        const buf = Buffer.allocUnsafe(len)
        const { bytesRead } = await handle.read(buf, 0, len, pos)
        if (bytesRead <= 0) break
        pos += bytesRead
        const slice = bytesRead === len ? buf : buf.subarray(0, bytesRead)
        const combined = carry.length ? Buffer.concat([carry, slice]) : slice
        const lastNl = combined.lastIndexOf(NL)
        if (lastNl >= 0) {
          for (const line of combined.toString("utf8", 0, lastNl).split("\n")) {
            usage = addLine(usage, line)
          }
          carry = Buffer.from(combined.subarray(lastNl + 1)) // copy: keep only the partial tail
        } else {
          carry = Buffer.from(combined)
        }
        // Yield between slices so a large first read never blocks the event loop (and thus
        // never delays PTY→renderer forwarding). No yield after the final slice.
        if (pos < st.size) await new Promise((r) => setImmediate(r))
      }
      // Offset lands on the last complete newline: everything read minus the partial tail.
      this.state.set(key, { offset: pos - carry.length, usage })
      return usage
    } catch {
      return prev.usage
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  /** Forget a transcript's accumulated state (SessionEnd for a session; after the terminal
   *  read for a sub-agent) to bound memory across long-lived, high-fan-out sessions. */
  forget(path: string): void {
    this.state.delete(path)
    this.chains.delete(path)
  }
}
