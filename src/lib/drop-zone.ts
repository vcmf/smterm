// Where a dragged surface would land in a pane, from the cursor position. Pure so the
// geometry is unit-tested; the pane overlay supplies its rect + the pointer coords.

import type { DropZone } from "../types"

/** Fraction of the pane's width/height (per side) that counts as an edge band. */
export const EDGE_BAND = 0.25

/** The zone under (x, y): the nearest edge if within its band, else the centre. */
export function dropZone(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DropZone {
  if (rect.width <= 0 || rect.height <= 0) return "center"
  // Distance to each edge as a fraction of that axis — so a wide pane doesn't favour top/bottom.
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const edges: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ]
  let best: [DropZone, number] = ["center", EDGE_BAND]
  for (const e of edges) if (e[1] < best[1]) best = e
  return best[0]
}

/** Insert position in a tab strip: before the tab under x, or after it past its midpoint. */
export function insertIndex(tabRects: { left: number; width: number }[], x: number): number {
  for (let i = 0; i < tabRects.length; i++) {
    const r = tabRects[i]!
    if (x < r.left + r.width / 2) return i
  }
  return tabRects.length
}
