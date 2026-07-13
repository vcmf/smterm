// Batches high-frequency PTY output into fewer IPC messages. node-pty emits many
// tiny chunks under load; forwarding each as its own main→renderer message halves
// throughput (see docs/PERF.md). Buffer and flush as ONE message on a short timer or a
// size cap — order-preserving (chunks are joined, never split).

export class OutputCoalescer {
  private chunks: string[] = []
  private size = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly flushMs: number,
    private readonly maxBytes: number,
    private readonly onFlush: (data: string) => void,
  ) {}

  push(data: string): void {
    this.chunks.push(data)
    this.size += data.length
    if (this.size >= this.maxBytes) {
      this.flush() // firehose — send now, don't grow the buffer or add latency
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.chunks.length === 0) return
    const data = this.chunks.join("")
    this.chunks = []
    this.size = 0
    this.onFlush(data)
  }

  /** Drop buffered output + pending timer without flushing, but stay usable.
   *  Used on reattach: the dropped bytes are already in the session's OutputBuffer
   *  and get replayed from there, so flushing them here too would duplicate output. */
  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.chunks = []
    this.size = 0
  }

  /** Drop any buffered output + pending timer without flushing (on kill). */
  dispose(): void {
    this.reset()
  }
}
