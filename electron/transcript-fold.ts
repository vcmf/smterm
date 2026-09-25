// Incremental, chunked fold over an append-only JSONL file (Claude Code transcripts).
// Keeps a byte offset + folded value per file; each update reads only the newly-appended
// bytes, in bounded slices that yield to the event loop, so a large first read (a resumed
// 30 MB+ transcript) never stalls PTY forwarding. Shared by token accounting
// (transcript-tokens) and session metadata (transcript-meta).

import fs from "node:fs"

const NL = 0x0a // '\n'
// 256 KiB read+parse slices. Measured on a 90 MB / 30k-line transcript: the worst single
// synchronous parse burst between event-loop yields is ~4.6 ms (vs ~13 ms at 1 MiB, ~318 ms
// un-chunked) — comfortably under a frame, and only on the first read of a resumed session.
const DEFAULT_CHUNK = 1 << 18

/** Fold appended transcript lines into a value of type T (see file comment). Lives in the
 *  main process, off the terminal hot path. */
export class TranscriptFold<T> {
  private state = new Map<string, { offset: number; value: T }>()
  // Per-key promise chain: serialize reads of the same transcript so two overlapping updates
  // can't read the same offset twice and double-fold the appended bytes.
  private chains = new Map<string, Promise<T>>()
  // Liveness token per key: forget() drops it, so a read still in flight when its key is
  // forgotten can't write its state back (an orphan nothing would ever remove).
  private tokens = new Map<string, object>()

  // chunkBytes is injectable so tests can force multi-chunk / line-boundary paths.
  constructor(
    private readonly fold: (acc: T, line: string) => T,
    private readonly empty: T,
    private readonly chunkBytes: number = DEFAULT_CHUNK,
  ) {}

  /** Read new bytes of the transcript, fold them in, and return the cumulative value.
   *  `candidates` are try-in-order host paths for the same file (>1 only on WSL, where a Linux
   *  path resolves to distro UNC shares); state is keyed by `key` so it's stable regardless of
   *  which candidate wins. Reads of the same key are serialized; any fs error yields the prior
   *  value (best-effort). */
  update(key: string, candidates: string[] = [key]): Promise<T> {
    let token = this.tokens.get(key)
    if (!token) this.tokens.set(key, (token = {}))
    const tok = token
    const next = (this.chains.get(key) ?? Promise.resolve(this.empty))
      .catch(() => this.empty)
      .then(() => this.readOnce(key, candidates, tok))
    this.chains.set(key, next)
    return next
  }

  private async readOnce(key: string, candidates: string[], tok: object): Promise<T> {
    const prev = this.state.get(key) ?? { offset: 0, value: this.empty }
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
      if (!target || !st) return prev.value
      // Rotated/truncated (or a different file at this path) → re-fold from the start.
      const from = st.size < prev.offset ? 0 : prev.offset
      let value = from === 0 ? this.empty : prev.value
      if (st.size <= from) {
        if (this.tokens.get(key) === tok) this.state.set(key, { offset: from, value })
        return value
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
            value = this.fold(value, line)
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
      if (this.tokens.get(key) === tok) this.state.set(key, { offset: pos - carry.length, value })
      return value
    } catch {
      return prev.value
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  /** Forget a transcript's accumulated state (bounds memory across long-lived sessions). */
  forget(path: string): void {
    this.state.delete(path)
    this.chains.delete(path)
    this.tokens.delete(path)
  }
}
