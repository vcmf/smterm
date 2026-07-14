// Loopback receiver for Claude Code `http` hooks (M6 6b). It ACKs every POST
// immediately (200 {}) and does all normalisation + coalescing OFF the response
// path, so it can never slow the agent's loop or the terminal (see the
// performance rules in docs/design/AGENT_OBSERVABILITY.md §8). The renderer holds
// the AgentGraph and runs the pure reducer; main just forwards normalised batches.

import http from "node:http"
import type { AddressInfo } from "node:net"
import type { AgentEvent } from "../src/lib/agent-graph"

// tool_input keys that carry a file path, across the file-touching tools.
const FILE_TOOL_KEYS = ["file_path", "path", "notebook_path"] as const

/** Raw hook JSON (+ the pane id from the x-smterm-pane header) → the normalised
 *  AgentEvent; null if the payload lacks the minimum (event name + session id). */
export function normalizeHookEvent(raw: unknown, paneId?: string): AgentEvent | null {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.hook_event_name !== "string" || typeof r.session_id !== "string") return null
  const ti = (typeof r.tool_input === "object" && r.tool_input ? r.tool_input : {}) as Record<
    string,
    unknown
  >
  const filePath = FILE_TOOL_KEYS.map((k) => ti[k]).find((v) => typeof v === "string") as
    string | undefined
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  return {
    event: r.hook_event_name,
    sessionId: r.session_id,
    paneId: paneId || undefined,
    agentId: str(r.agent_id),
    agentType: str(r.agent_type),
    cwd: str(r.cwd),
    toolName: str(r.tool_name),
    filePath,
    message: str(r.message) ?? str(r.last_assistant_message),
  }
}

export interface HookReceiver {
  port: number
  close: () => Promise<void>
}

export interface HookReceiverOptions {
  token: string // shared secret; POSTs must send it in the x-smterm-token header
  onBatch: (events: AgentEvent[]) => void // coalesced, off the response path
  coalesceMs?: number // batch window (default 50ms) — one emit per window, not per event
  maxBodyBytes?: number // reject bodies larger than this (default 1 MiB) to bound memory
}

/** Start the loopback hook receiver on an ephemeral 127.0.0.1 port. */
export async function startHookReceiver(opts: HookReceiverOptions): Promise<HookReceiver> {
  const coalesceMs = opts.coalesceMs ?? 50
  const maxBody = opts.maxBodyBytes ?? 1024 * 1024
  let pending: AgentEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pending.length === 0) return
    const batch = pending
    pending = []
    try {
      opts.onBatch(batch)
    } catch {
      // a consumer error must never take down the receiver
    }
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, coalesceMs)
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405)
      res.end()
      return
    }
    if (req.headers["x-smterm-token"] !== opts.token) {
      res.writeHead(403)
      res.end()
      return
    }
    const paneHeader = req.headers["x-smterm-pane"]
    const paneId = Array.isArray(paneHeader) ? paneHeader[0] : paneHeader
    // Accumulate raw Buffer chunks and decode ONCE at the end — decoding each chunk
    // independently corrupts a multi-byte UTF-8 sequence split across a chunk boundary
    // (e.g. CJK/emoji in last_assistant_message). `size` counts exact bytes for the cap.
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on("data", (c: Buffer) => {
      if (tooBig) return
      size += c.length
      if (size > maxBody) {
        tooBig = true
        chunks.length = 0 // over the cap — drop it; we won't process this event
      } else {
        chunks.push(c)
      }
    })
    req.on("end", () => {
      // ACK FIRST — the response never waits on parsing, reduction, or IPC.
      res.writeHead(200, { "content-type": "application/json" })
      res.end("{}")
      if (tooBig) return
      const body = Buffer.concat(chunks).toString("utf8")
      // Defer everything else off the response so acks stay sub-millisecond.
      queueMicrotask(() => {
        let raw: unknown
        try {
          raw = JSON.parse(body)
        } catch {
          return
        }
        const ev = normalizeHookEvent(raw, paneId)
        if (ev) {
          pending.push(ev)
          schedule()
        }
      })
    })
    req.on("error", () => {})
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        if (timer) clearTimeout(timer)
        server.close(() => resolve())
      }),
  }
}
