export type SessionStatus = "idle" | "working" | "attention"

export interface Signals {
  status: SessionStatus
  unread: boolean
}

export const initialSignals: Signals = { status: "idle", unread: false }

export type SignalEvent =
  | { type: "command-start" } // OSC 133;C — a command began running
  | { type: "command-end" } // OSC 133;D — command finished
  | { type: "attention" } // OSC 9 — program/agent requests attention
  | { type: "output" } // any PTY output
  | { type: "output-idle" } // output went quiet for a while (idle-timer fired)
  | { type: "reveal" } // the session became visible to the user

/**
 * Pure transition for a session's status/unread given an event and whether the
 * session is currently visible to the user. No side effects — unit-tested.
 *
 * The output/output-idle pair is the generic agent-status heuristic: a running
 * command (working) that keeps streaming stays working, but once its output goes
 * quiet it flips to "attention" — the moment an agent (e.g. Claude Code) finishes
 * a turn and waits for input. Fresh output resumes "working". A plain idle prompt
 * never enters working (only command-start does), so it never false-flags.
 */
export function reduceSignals(cur: Signals, ev: SignalEvent, visible: boolean): Signals {
  switch (ev.type) {
    case "reveal":
      return { status: cur.status === "attention" ? "idle" : cur.status, unread: false }
    case "command-start":
      return { status: "working", unread: cur.unread }
    case "command-end":
      return { status: "idle", unread: cur.unread || !visible }
    case "attention":
      return visible ? cur : { status: "attention", unread: true }
    case "output": {
      // Activity resumes a task that had gone quiet (attention → working).
      const status = cur.status === "attention" ? "working" : cur.status
      return { status, unread: visible ? cur.unread : true }
    }
    case "output-idle":
      return cur.status === "working"
        ? { status: "attention", unread: cur.unread || !visible }
        : cur
  }
}

export type TabBadge = "attention" | "working" | "unread" | null

/** Aggregate a tab's badge from its sessions' signals (attention > working > unread). */
export function aggregateBadge(signals: Signals[]): TabBadge {
  let working = false
  let unread = false
  for (const s of signals) {
    if (s.status === "attention") return "attention"
    if (s.status === "working") working = true
    if (s.unread) unread = true
  }
  return working ? "working" : unread ? "unread" : null
}
