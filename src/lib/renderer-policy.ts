// WebGL renderer policy. Each terminal with WebGL holds a live GPU context;
// several at once share xterm's glyph atlas and creating one can disturb the
// others (garbled text — xterm.js #4379/#3303, still unsolved upstream), and
// browsers cap live contexts and evict the oldest. Heavy multi-pane use (several
// agent TUIs in split panes) is exactly that regime.
//
// Three modes (mirrors VS Code's `gpuAcceleration: on | off`, plus a safe middle):
//   auto  — WebGL for the FOCUSED pane only; DOM for the rest. One context can't
//           corrupt itself, so this is garble-free by construction while keeping
//           GPU speed on the pane you're actually watching. The default.
//   webgl — WebGL for EVERY visible pane (crisp glyphs everywhere, like VS Code).
//           The manager rebuilds the shared atlas after the pane set changes (see
//           terminal-manager `reconcileRenderers`) to clear cross-context garble.
//           If your GPU/driver still garbles on split, fall back to auto.
//   dom   — DOM everywhere: no GPU context, no atlas, always correct, a bit slower.

export type RendererMode = "auto" | "webgl" | "dom"

/** Which on-screen panes (by session id) should hold a live WebGL context, given
 *  the mode, the visible panes, and which one is focused. `dom` → none; `webgl` →
 *  all visible; `auto` → just the focused one (falling back to the first visible
 *  when focus isn't among them, e.g. right after a tab switch). */
export function webglPanes(
  mode: RendererMode,
  visible: string[],
  focusedId: string | null | undefined,
): Set<string> {
  const first = visible[0]
  if (mode === "dom" || first === undefined) return new Set()
  if (mode === "webgl") return new Set(visible)
  const one = focusedId && visible.includes(focusedId) ? focusedId : first
  return new Set([one])
}
