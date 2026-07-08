export interface ShellOption {
  id: string
  label: string
  command: string
  args: string[]
}

import type { SessionStatus } from "./lib/session-status"

export interface Session {
  id: string
  title: string
  command: string
  args: string[]
  status: SessionStatus
  unread: boolean
  running?: boolean // a command/agent is executing (OSC 133 C..D)
  cwd?: string // reported by the shell via OSC 7; drives the git diff panel
  oscTitle?: string // raw window title from OSC 0/2 (a program may set it)
  detail?: string // why it needs attention (OSC-9 message / "needs input")
}

/** A tab's layout: a binary tree of leaves (terminals) and splits. */
export type PaneNode =
  | { type: "leaf"; sessionId: string }
  | {
      type: "split"
      id: string
      direction: "row" | "column"
      children: [PaneNode, PaneNode]
    }

export interface Tab {
  id: string
  title: string
  root: PaneNode
  activeSessionId: string
}
