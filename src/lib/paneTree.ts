import type { PaneNode } from "../types"

/** A single-terminal pane. */
export const makeLeaf = (sessionId: string): PaneNode => ({
  type: "leaf",
  sessionId,
})

/**
 * Split the leaf holding `targetSessionId` into a `direction` split whose two
 * children are the original leaf and a new leaf for `newSessionId`.
 * IDs are passed in (not generated) to keep this pure and testable.
 */
export function splitNode(
  node: PaneNode,
  targetSessionId: string,
  direction: "row" | "column",
  newSessionId: string,
  newSplitId: string,
): PaneNode {
  if (node.type === "leaf") {
    if (node.sessionId !== targetSessionId) return node
    return {
      type: "split",
      id: newSplitId,
      direction,
      children: [node, makeLeaf(newSessionId)],
    }
  }
  return {
    ...node,
    children: [
      splitNode(node.children[0], targetSessionId, direction, newSessionId, newSplitId),
      splitNode(node.children[1], targetSessionId, direction, newSessionId, newSplitId),
    ],
  }
}

/**
 * Remove the leaf for `targetSessionId`. A split left with a single child
 * collapses into that child. Returns null if the whole tree is removed.
 */
export function removeNode(node: PaneNode, targetSessionId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.sessionId === targetSessionId ? null : node
  }
  const left = removeNode(node.children[0], targetSessionId)
  const right = removeNode(node.children[1], targetSessionId)
  if (left && right) return { ...node, children: [left, right] }
  return left ?? right
}

/** All session ids under a node (left-to-right). */
export function allSessionIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.sessionId]
  return [...allSessionIds(node.children[0]), ...allSessionIds(node.children[1])]
}

/** The leftmost session id — used to pick a new active pane after a close. */
export function firstSessionId(node: PaneNode): string {
  let cur: PaneNode = node
  while (cur.type === "split") cur = cur.children[0]
  return cur.sessionId
}

/** Stable React/panel key for a node. */
export const nodeKey = (node: PaneNode): string => (node.type === "leaf" ? node.sessionId : node.id)
