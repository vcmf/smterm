import type { PaneLeaf, PaneNode } from "../types"

// Pure pane-tree ops. A leaf is a pane holding one or more terminals (surfaces);
// IDs are passed in (not generated) to keep everything pure and testable. Ops return
// the same node reference when nothing changed so store selectors stay quiet.

/** A pane with a single terminal. */
export const makeLeaf = (paneId: string, sessionId: string): PaneLeaf => ({
  type: "leaf",
  id: paneId,
  sessionIds: [sessionId],
  activeSessionId: sessionId,
})

/** Rebuild splits only along the path where a child actually changed. */
function mapLeaves(node: PaneNode, fn: (leaf: PaneLeaf) => PaneNode): PaneNode {
  if (node.type === "leaf") return fn(node)
  const a = mapLeaves(node.children[0], fn)
  const b = mapLeaves(node.children[1], fn)
  return a === node.children[0] && b === node.children[1] ? node : { ...node, children: [a, b] }
}

/** Drop leaves for which `fn` returns null; a split left with one child collapses into it. */
function filterLeaves(node: PaneNode, fn: (leaf: PaneLeaf) => PaneNode | null): PaneNode | null {
  if (node.type === "leaf") return fn(node)
  const a = filterLeaves(node.children[0], fn)
  const b = filterLeaves(node.children[1], fn)
  if (a && b) {
    return a === node.children[0] && b === node.children[1] ? node : { ...node, children: [a, b] }
  }
  return a ?? b
}

/**
 * Split the pane holding `targetSessionId` into a `direction` split whose two
 * children are that pane and a new pane (`newPaneId`) for `newSessionId`.
 */
export function splitNode(
  node: PaneNode,
  targetSessionId: string,
  direction: "row" | "column",
  newSessionId: string,
  newSplitId: string,
  newPaneId: string,
): PaneNode {
  return mapLeaves(node, (leaf) =>
    leaf.sessionIds.includes(targetSessionId)
      ? {
          type: "split",
          id: newSplitId,
          direction,
          children: [leaf, makeLeaf(newPaneId, newSessionId)],
        }
      : leaf,
  )
}

/** Append `sessionId` as a new surface of pane `paneId` and make it the active one. */
export function addSurface(node: PaneNode, paneId: string, sessionId: string): PaneNode {
  return mapLeaves(node, (leaf) =>
    leaf.id === paneId && !leaf.sessionIds.includes(sessionId)
      ? { ...leaf, sessionIds: [...leaf.sessionIds, sessionId], activeSessionId: sessionId }
      : leaf,
  )
}

/** Make `sessionId` the visible surface of whichever pane holds it. */
export function selectSurface(node: PaneNode, sessionId: string): PaneNode {
  return mapLeaves(node, (leaf) =>
    leaf.sessionIds.includes(sessionId) && leaf.activeSessionId !== sessionId
      ? { ...leaf, activeSessionId: sessionId }
      : leaf,
  )
}

/** Remove a surface (right, else left, neighbour shows); an emptied pane collapses; null if none left. */
export function removeNode(node: PaneNode, targetSessionId: string): PaneNode | null {
  return filterLeaves(node, (leaf) => {
    const idx = leaf.sessionIds.indexOf(targetSessionId)
    if (idx === -1) return leaf
    const sessionIds = leaf.sessionIds.filter((id) => id !== targetSessionId)
    if (sessionIds.length === 0) return null
    const activeSessionId =
      leaf.activeSessionId === targetSessionId
        ? sessionIds[Math.min(idx, sessionIds.length - 1)]!
        : leaf.activeSessionId
    return { ...leaf, sessionIds, activeSessionId }
  })
}

/** Remove pane `paneId` with all its surfaces. Returns null if the whole tree is removed. */
export function removePane(node: PaneNode, paneId: string): PaneNode | null {
  return filterLeaves(node, (leaf) => (leaf.id === paneId ? null : leaf))
}

/** The pane holding `sessionId`, if any. */
export const findPane = (node: PaneNode, sessionId: string): PaneLeaf | undefined =>
  allPanes(node).find((p) => p.sessionIds.includes(sessionId))

/** The pane whose PaneLeaf.id is `paneId` (not a session id), if any. */
export const findPaneById = (node: PaneNode, paneId: string): PaneLeaf | undefined =>
  allPanes(node).find((p) => p.id === paneId)

/** All panes (leaves), left-to-right. */
export function allPanes(node: PaneNode): PaneLeaf[] {
  if (node.type === "leaf") return [node]
  return [...allPanes(node.children[0]), ...allPanes(node.children[1])]
}

/** Every session id under a node — hidden surfaces included (left-to-right). */
export function allSessionIds(node: PaneNode): string[] {
  return allPanes(node).flatMap((p) => p.sessionIds)
}

/** Only the on-screen session ids: each pane's active surface. */
export function visibleSessionIds(node: PaneNode): string[] {
  return allPanes(node).map((p) => p.activeSessionId)
}

/** The leftmost pane's visible session — used to pick a new focus after a close. */
export function firstSessionId(node: PaneNode): string {
  let cur: PaneNode = node
  while (cur.type === "split") cur = cur.children[0]
  return cur.activeSessionId
}

/** Stable React/panel key for a node. */
export const nodeKey = (node: PaneNode): string => node.id
