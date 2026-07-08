// A bounded ring buffer of recent raw PTY output, kept per session so that a
// renderer which reloaded (dev HMR on resume, or a GPU-process crash) can REATTACH
// to the still-running shell and replay history — instead of spawning a fresh one
// and orphaning the old (see main.ts pty:spawn reattach branch). Capacity is a byte
// budget (approx: string length ≈ bytes, same as OutputCoalescer); oldest whole
// chunks drop off the front first, so we never split an escape sequence except when
// a single chunk alone exceeds the cap (then we keep its tail).

export class OutputBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly maxBytes: number) {}

  push(data: string): void {
    if (data.length === 0) return
    this.chunks.push(data)
    this.size += data.length
    // Drop oldest whole chunks until we're back under budget (keep at least one).
    while (this.size > this.maxBytes && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length
    }
    // A single chunk larger than the whole budget: keep only its tail.
    if (this.size > this.maxBytes && this.chunks.length === 1) {
      const only = this.chunks[0]!
      const tail = only.slice(only.length - this.maxBytes)
      this.chunks[0] = tail
      this.size = tail.length
    }
  }

  /** All retained output, oldest-first, as one string (for replay on reattach). */
  dump(): string {
    return this.chunks.join("")
  }

  get bytes(): number {
    return this.size
  }

  clear(): void {
    this.chunks = []
    this.size = 0
  }
}
