// WebGL renderer policy. Each terminal with WebGL holds a live GPU context;
// several at once corrupt each other's glyph atlas (garbled text — xterm.js
// #4379/#3303, still unsolved upstream) and browsers cap live contexts and evict
// the oldest. Heavy multi-pane use (several agent TUIs in split panes) is exactly
// that regime. So we keep at most ONE live context.
//
// Two modes (mirrors VS Code's `gpuAcceleration: on | off`):
//   auto — WebGL for the FOCUSED pane only; DOM for the rest. One context can't
//          corrupt itself, so this is garble-free by construction while keeping
//          GPU speed on the pane you're actually watching. The default.
//   dom  — DOM everywhere: no GPU context, no atlas, always correct, a bit slower.
//
// There is deliberately no "WebGL on every pane" mode: that's the unsupported
// many-contexts case, so we don't offer the footgun.

export type RendererMode = "auto" | "dom"

/** Which on-screen panes (by session id) should hold a live WebGL context, given
 *  the mode, the visible panes, and which one is focused. At most one; empty = DOM
 *  everywhere. Falls back to the first visible pane when focus isn't among them
 *  (e.g. just after a tab switch). */
export function webglPanes(
  mode: RendererMode,
  visible: string[],
  focusedId: string | null | undefined,
): Set<string> {
  const first = visible[0]
  if (mode === "dom" || first === undefined) return new Set()
  const one = focusedId && visible.includes(focusedId) ? focusedId : first
  return new Set([one])
}
