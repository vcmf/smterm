// PTY resize deduplication. A layout change (e.g. splitting a pane) can fire xterm's
// ResizeObserver on panes whose *character grid* doesn't actually change. Sending a
// pty_resize anyway makes the OS deliver SIGWINCH to the running program, which then
// redraws its whole screen — a visible hiccup in other panes. Only resize when the
// grid genuinely changed. Pure — unit-tested.

export interface Grid {
  cols: number
  rows: number
}

/** True when the PTY needs a resize: no prior grid, or cols/rows differ. */
export function gridChanged(last: Grid | undefined, cols: number, rows: number): boolean {
  return !last || last.cols !== cols || last.rows !== rows
}
