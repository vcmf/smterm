export type SessionStatus = "idle" | "working" | "attention"

export interface Signals {
  status: SessionStatus
  unread: boolean
  running?: boolean // a command is executing (between OSC 133 C and D)
}

export const initialSignals: Signals = { status: "idle", unread: false, running: false }

export type SignalEvent =
  | { type: "command-start" } // OSC 133;C — a command began running
  | { type: "command-end" } // OSC 133;D — command finished
  | { type: "attention"; detail?: string } // OSC 9 / bell — program requests attention
  | { type: "output" } // any PTY output
  | { type: "output-idle" } // output went quiet for a while (idle-timer fired)
  | { type: "reveal" } // the session became visible to the user

/**
 * Pure transition for a session's status/unread given an event and whether the
 * session is currently visible to the user. No side effects — unit-tested.
 *
 * `running` tracks whether a command/agent is executing (C..D). It's what lets a
 * still-running agent that we "cleared" (on reveal/focus) or that went quiet come
 * back to "working" — plain output alone never wakes an idle prompt to working
 * (that would make every terminal flash "working" after each command).
 *
 * The heuristic never flags the pane you're looking at (`visible`): you're the
 * input, so nagging the focused pane is wrong — it only creates a
 * running↔needs-input flicker as you type.
 */
export function reduceSignals(cur: Signals, ev: SignalEvent, visible: boolean): Signals {
  const running = cur.running ?? false
  switch (ev.type) {
    case "reveal":
      // Seen: drop attention, but a still-running agent stays "working".
      return {
        status: cur.status === "attention" ? (running ? "working" : "idle") : cur.status,
        unread: false,
        running,
      }
    case "command-start":
      return { status: "working", unread: cur.unread, running: true }
    case "command-end":
      return { status: "idle", unread: cur.unread || !visible, running: false }
    case "attention":
      return visible ? cur : { status: "attention", unread: true, running }
    case "output": {
      // Activity while a command runs (or resuming a quiet task) = working.
      const status = running || cur.status === "attention" ? "working" : cur.status
      return { status, unread: visible ? cur.unread : true, running }
    }
    case "output-idle":
      // A running command that went quiet, off-screen ⇒ it's waiting on you.
      return !visible && running ? { status: "attention", unread: true, running } : cur
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
