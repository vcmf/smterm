import { describe, it, expect, afterEach } from "vitest"
import http from "node:http"
import { startHookReceiver, normalizeHookEvent } from "./agent-hooks"
import type { HookReceiver } from "./agent-hooks"
import { reduceAgentEvents } from "../src/lib/agent-graph"
import type { AgentEvent } from "../src/lib/agent-graph"

const TOKEN = "test-token"
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 })

let receiver: HookReceiver | null = null
afterEach(async () => {
  await receiver?.close()
  receiver = null
})

/** POST a JSON body; resolves with the status code and round-trip ms. */
function post(
  port: number,
  body: unknown,
  {
    token = TOKEN,
    method = "POST" as string,
    pane,
  }: { token?: string; method?: string; pane?: string } = {},
): Promise<{ status: number; ms: number }> {
  return new Promise((resolve) => {
    const data = typeof body === "string" ? body : JSON.stringify(body)
    const t0 = performance.now()
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: "/",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          "x-smterm-token": token,
          ...(pane ? { "x-smterm-pane": pane } : {}),
        },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve({ status: res.statusCode ?? 0, ms: performance.now() - t0 }))
      },
    )
    req.on("error", () => resolve({ status: 0, ms: performance.now() - t0 }))
    req.write(data)
    req.end()
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("normalizeHookEvent", () => {
  it("normalises a sub-agent tool event", () => {
    const ev = normalizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        agent_id: "a1",
        agent_type: "Explore",
        cwd: "/repo",
        tool_name: "Read",
        tool_input: { file_path: "/repo/x.ts" },
      },
      "pane-7",
    )
    expect(ev).toEqual({
      event: "PreToolUse",
      sessionId: "s1",
      paneId: "pane-7",
      agentId: "a1",
      agentType: "Explore",
      cwd: "/repo",
      toolName: "Read",
      filePath: "/repo/x.ts",
      message: undefined,
    })
  })

  it("falls back to last_assistant_message; drops payloads missing the essentials", () => {
    expect(
      normalizeHookEvent({
        hook_event_name: "SubagentStop",
        session_id: "s1",
        last_assistant_message: "hi",
      })?.message,
    ).toBe("hi")
    expect(normalizeHookEvent({ session_id: "s1" })).toBeNull() // no event name
    expect(normalizeHookEvent({ hook_event_name: "Stop" })).toBeNull() // no session id
    expect(normalizeHookEvent(null)).toBeNull()
  })
})

describe("hook receiver — behaviour", () => {
  it("acks and forwards a normalised event", async () => {
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 20,
      onBatch: (b) => batches.push(b),
    })
    const r = await post(receiver.port, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/repo",
    })
    expect(r.status).toBe(200)
    await sleep(60)
    expect(batches.flat()).toEqual([
      {
        event: "SessionStart",
        sessionId: "s1",
        paneId: undefined,
        cwd: "/repo",
        agentId: undefined,
        agentType: undefined,
        toolName: undefined,
        filePath: undefined,
        message: undefined,
      },
    ])
  })

  it("tags events with the pane id from the x-smterm-pane header", async () => {
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 20,
      onBatch: (b) => batches.push(b),
    })
    await post(
      receiver.port,
      { hook_event_name: "SessionStart", session_id: "s1" },
      { pane: "pane-42" },
    )
    await sleep(60)
    expect(batches.flat()[0]?.paneId).toBe("pane-42")
  })

  it("ACKs BEFORE any processing/emit (ack never waits on the reducer or IPC)", async () => {
    let emitted = false
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 100,
      onBatch: () => (emitted = true),
    })
    const r = await post(receiver.port, { hook_event_name: "SessionStart", session_id: "s1" })
    expect(r.status).toBe(200)
    expect(emitted).toBe(false) // response returned before the coalesced emit fired
    await sleep(140)
    expect(emitted).toBe(true)
  })

  it("coalesces a burst into a single batch", async () => {
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 80,
      onBatch: (b) => batches.push(b),
    })
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post(receiver!.port, { hook_event_name: "UserPromptSubmit", session_id: `s${i}` }),
      ),
    )
    await sleep(120)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(5)
  })

  it("rejects a wrong token (403) and a non-POST (405); neither is forwarded", async () => {
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 20,
      onBatch: (b) => batches.push(b),
    })
    expect(
      (await post(receiver.port, { hook_event_name: "Stop", session_id: "s1" }, { token: "wrong" }))
        .status,
    ).toBe(403)
    expect((await post(receiver.port, {}, { method: "GET" })).status).toBe(405)
    await sleep(50)
    expect(batches.flat()).toHaveLength(0)
  })

  it("acks but drops an oversized body", async () => {
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 20,
      maxBodyBytes: 200,
      onBatch: (b) => batches.push(b),
    })
    const big = {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      tool_input: { blob: "x".repeat(5000) },
    }
    expect((await post(receiver.port, big)).status).toBe(200)
    await sleep(50)
    expect(batches.flat()).toHaveLength(0)
  })
})

describe("hook receiver — load test", () => {
  it("handles thousands of events: acks all, coalesces, and reduces to a correct tree", async () => {
    // Build a realistic stream: many sessions, each launching a sub-agent that
    // does many tool calls. Shape mirrors the captured spike stream.
    const SESSIONS = 25
    const TOOLS_PER_AGENT = 100
    const raws: Record<string, unknown>[] = []
    for (let s = 0; s < SESSIONS; s++) {
      const session_id = `s${s}`
      const agent_id = `a${s}`
      raws.push({ hook_event_name: "SessionStart", session_id, cwd: "/repo" })
      raws.push({ hook_event_name: "UserPromptSubmit", session_id })
      raws.push({ hook_event_name: "PreToolUse", session_id, tool_name: "Agent" })
      raws.push({ hook_event_name: "SubagentStart", session_id, agent_id, agent_type: "Explore" })
      for (let t = 0; t < TOOLS_PER_AGENT; t++) {
        const tool_input = { file_path: `/repo/f${t}.ts` }
        raws.push({
          hook_event_name: "PreToolUse",
          session_id,
          agent_id,
          tool_name: "Read",
          tool_input,
        })
        raws.push({
          hook_event_name: "PostToolUse",
          session_id,
          agent_id,
          tool_name: "Read",
          tool_input,
        })
      }
      raws.push({
        hook_event_name: "SubagentStop",
        session_id,
        agent_id,
        last_assistant_message: "done",
      })
      raws.push({ hook_event_name: "Stop", session_id })
      // (no SessionEnd — keep the sessions "live" so the shape assertions below hold;
      //  SessionEnd eviction + turn pruning are covered in agent-graph's unit tests.)
    }
    const N = raws.length // ~5150

    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 50,
      onBatch: (b) => batches.push(b),
    })

    // Fire everything with bounded concurrency; collect ack statuses + latencies.
    const CONCURRENCY = 64
    const stats: { status: number; ms: number }[] = new Array(N)
    let next = 0
    const t0 = performance.now()
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < N) {
          const i = next++
          stats[i] = await post(receiver!.port, raws[i]!)
        }
      }),
    )
    const wall = performance.now() - t0
    await sleep(150) // let the final coalesce window flush

    // 1) Every POST was acked 200.
    expect(stats.every((s) => s.status === 200)).toBe(true)

    // 2) Every event was delivered exactly once, coalesced into far fewer batches.
    const delivered = batches.flat()
    expect(delivered).toHaveLength(N)
    expect(batches.length).toBeLessThan(N / 10)

    // 3) Reducing the delivered stream is cheap and yields one live root per session.
    //    (A fully-concurrent blast doesn't preserve per-session order, and turn-pruning
    //    is order-sensitive, so we assert only order-independent facts here; ordered
    //    status + pruning/eviction are covered in the reducer's own unit tests.)
    const rt0 = performance.now()
    const g = reduceAgentEvents(delivered)
    const reduceMs = performance.now() - rt0
    expect(g.rootIds).toHaveLength(SESSIONS) // roots aren't pruned/evicted in this stream

    // 4) Perf: everything well under generous CI bounds.
    const maxAck = Math.max(...stats.map((s) => s.ms))
    const avgAck = stats.reduce((a, s) => a + s.ms, 0) / N

    console.log(
      `[load] ${N} events in ${wall.toFixed(0)}ms (${((N / wall) * 1000).toFixed(0)}/s) · ack avg ${avgAck.toFixed(2)}ms max ${maxAck.toFixed(1)}ms · ${batches.length} batches · reduce ${reduceMs.toFixed(1)}ms`,
    )
    expect(wall).toBeLessThan(15000)
    expect(reduceMs).toBeLessThan(200)
    expect(maxAck).toBeLessThan(2000)
  })

  it("preserves per-session order for a serialized stream (as Claude actually sends them)", async () => {
    // Claude blocks on each hook's ack before the next action, so one session's
    // events reach us strictly in order. Fire them sequentially to mirror that.
    const batches: AgentEvent[][] = []
    receiver = await startHookReceiver({
      token: TOKEN,
      coalesceMs: 20,
      onBatch: (b) => batches.push(b),
    })
    const stream: Record<string, unknown>[] = [
      { hook_event_name: "SessionStart", session_id: "s1", cwd: "/repo" },
      { hook_event_name: "UserPromptSubmit", session_id: "s1" },
      { hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Agent" },
      { hook_event_name: "SubagentStart", session_id: "s1", agent_id: "a1", agent_type: "Explore" },
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        agent_id: "a1",
        tool_name: "Read",
        tool_input: { file_path: "/repo/x.ts" },
      },
      {
        hook_event_name: "PostToolUse",
        session_id: "s1",
        agent_id: "a1",
        tool_name: "Read",
        tool_input: { file_path: "/repo/x.ts" },
      },
      {
        hook_event_name: "SubagentStop",
        session_id: "s1",
        agent_id: "a1",
        last_assistant_message: "done",
      },
      { hook_event_name: "Stop", session_id: "s1" },
    ]
    for (const ev of stream) expect((await post(receiver.port, ev)).status).toBe(200)
    await sleep(60)

    const g = reduceAgentEvents(batches.flat())
    expect(g.nodes["a1"]!.status).toBe("done")
    expect(g.nodes["a1"]!.lastMessage).toBe("done")
    expect(g.nodes["root:s1"]!.status).toBe("idle") // Stop → idle (session still live)
    expect(g.nodes["root:s1"]!.childIds).toEqual(["a1"])
  })
})
