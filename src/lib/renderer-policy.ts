// WebGL renderer policy. Each terminal with WebGL holds a live GPU context;
// too many at once corrupts the glyph atlas (garbled text — xterm.js #4379/#3303).
// So we run WebGL only for terminals currently on-screen, and only when a
// sensible number of panes share the screen — otherwise the DOM renderer (no GPU
// context, no atlas) which is slower but rock-solid.

/** Above this many panes visible at once, the active tab falls back to DOM. */
export const MAX_WEBGL_PANES = 4

/** Whether the on-screen panes should use WebGL, given how many are visible. */
export function shouldUseWebgl(visiblePaneCount: number): boolean {
  return visiblePaneCount > 0 && visiblePaneCount <= MAX_WEBGL_PANES
}
