// Bridges hook events → token totals. On a turn/sub-agent finish we read the referenced
// transcript (incrementally) and emit a synthetic `TokenUsage` AgentEvent the renderer's
// pure reducer folds onto the matching node. Runs on the hook channel in the main process,
// off the terminal hot path — see startAgentObservability.

import type { AgentEvent } from "../src/lib/agent-graph"
import { TranscriptTokens } from "./transcript-tokens"

/** Which events to price, and which transcript to read for each:
 *   - Stop         → the session transcript  → the session root
 *   - SubagentStop → the sub-agent transcript → that sub-agent
 * SessionEnd frees the session transcript's accumulator. */
export async function tokenEventsForBatch(
  tracker: TranscriptTokens,
  batch: AgentEvent[],
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for (const ev of batch) {
    if (ev.event === "SessionEnd" && ev.transcriptPath) {
      tracker.forget(ev.transcriptPath)
      continue
    }
    // Session turn finished → price the session transcript against the root.
    if (ev.event === "Stop" && ev.transcriptPath) {
      const tokens = await tracker.update(ev.transcriptPath)
      out.push({ event: "TokenUsage", sessionId: ev.sessionId, tokens })
    }
    // Sub-agent finished → price its own transcript against that sub-agent.
    if (ev.event === "SubagentStop" && ev.agentId && ev.agentTranscriptPath) {
      const tokens = await tracker.update(ev.agentTranscriptPath)
      out.push({ event: "TokenUsage", sessionId: ev.sessionId, agentId: ev.agentId, tokens })
    }
  }
  return out
}
