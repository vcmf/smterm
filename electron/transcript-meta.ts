// Session metadata from a Claude Code transcript: the `/color` and `/rename` the user set.
// Claude records them as JSONL lines — `{"type":"agent-color","agentColor":"orange"}` and
// `{"type":"custom-title","customTitle":"…"}` (re-appended on resume, so the LATEST wins).
// Claude sends no terminal escape for either, so the transcript is the only source.
//
// NOTE (stability): the transcript is an internal Claude format; this parse is best-effort —
// an unrecognized shape is simply ignored (no accent) rather than an error.

import type { SessionMeta } from "../src/lib/session-color"
import { TranscriptFold } from "./transcript-fold"

export type { SessionMeta }

export const emptyMeta: SessionMeta = {}

/** Fold one transcript line into `acc` (pure). Latest `agent-color` / `custom-title` win;
 *  `default` (or no value) on an agent-color line is an explicit reset → `color: null`. */
export function addMetaLine(acc: SessionMeta, line: string): SessionMeta {
  const t = line.trim()
  // Cheap pre-filter: most lines are conversation turns — skip JSON.parse for them.
  if (!t || (!t.includes('"agent-color"') && !t.includes('"custom-title"'))) return acc
  let o: unknown
  try {
    o = JSON.parse(t)
  } catch {
    return acc
  }
  if (typeof o !== "object" || o === null) return acc
  const rec = o as { type?: unknown; agentColor?: unknown; customTitle?: unknown }
  if (rec.type === "agent-color") {
    const c = typeof rec.agentColor === "string" ? rec.agentColor.trim().toLowerCase() : ""
    const color = !c || c === "default" ? null : c
    return acc.color === color ? acc : { ...acc, color }
  }
  if (rec.type === "custom-title" && typeof rec.customTitle === "string") {
    const name = rec.customTitle.trim() || undefined
    return acc.name === name ? acc : { ...acc, name }
  }
  return acc
}

/** Incremental per-transcript metadata reader (see TranscriptFold). */
export class TranscriptMeta extends TranscriptFold<SessionMeta> {
  constructor(chunkBytes?: number) {
    super(addMetaLine, emptyMeta, chunkBytes)
  }
}
