// WebGL renderer policy. Each terminal with WebGL holds a live GPU context;
// creating one disturbs the siblings that share xterm's glyph atlas (garble on
// split — xterm.js #4379/#3303). We handle that by rebuilding the shared atlas
// after the pane set changes (see terminal-manager `reconcileRenderers`), which
// lets every visible pane run WebGL crisply, like VS Code.
//
// Two modes (mirrors VS Code's `gpuAcceleration: on | off`):
//   webgl — WebGL on every visible pane (crisp glyphs everywhere). The default.
//   dom   — no GPU anywhere; always correct, a bit slower. The fallback for
//           GPUs/drivers that can't hold multiple contexts cleanly.

export type RendererMode = "webgl" | "dom"

/** Which on-screen panes (by session id) should hold a live WebGL context:
 *  every visible pane in `webgl` mode, none in `dom` mode. */
export function webglPanes(mode: RendererMode, visible: string[]): Set<string> {
  return mode === "dom" ? new Set() : new Set(visible)
}
