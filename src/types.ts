export interface ShellOption {
  id: string
  label: string
  command: string
  args: string[]
}

import type { SessionStatus } from "./lib/sessionStatus"

export interface Session {
  id: string
  title: string
  command: string
  args: string[]
  status: SessionStatus
  unread: boolean
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
