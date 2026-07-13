# Investigation — persistent glyph garble + Claude Code lag

> Untracked working doc (2026-07-10). PR #3 (`repairRenderers` on focus/DPR/resize) did **not**
> fix the garble — because it treated the wrong cause. This is the deeper analysis + fix ideas.
> Not committed; discussion first.

## Symptoms (reported)

1. **Glyph garble still happens** — same as before PR #3. Text mis-renders until something forces a
   repaint.
2. **Claude Code conversations feel laggy / heavy** — sluggish while an agent streams.

## Why PR #3 missed it

PR #3 added `repairRenderers()` and fired it on **window focus / visibilitychange / DPR change /
debounced resize** — i.e. it assumed the garble came from the atlas going _stale while
backgrounded / after a display change_. That's a real failure mode, but it isn't the one biting here:
the garble recurs **during normal use**, when none of those events fire. So the repair never runs at
the moment corruption is introduced.

## UPDATE (sharper repro): garble triggers **on split, and just after**

This pins it to the **split action**, which does two garble-inducing things at once:

1. **H5 — the WebGL canvas is reparented with no repaint (PRIMARY for "just after").** Splitting
   restructures the pane tree, so the split pane's `TerminalPane` **remounts**; its effect calls
   `TerminalManager.attach(...)` (`src/terminal/terminal-manager.ts` `attach`), which does
   `container.appendChild(entry.host)` — **moving the live WebGL canvas into the new container** — then
   `syncSize` + `reconcileRenderers` + `focus`. **There is no `refresh()`/`repairRenderers()` after the
   reparent.** A reparented WebGL canvas keeps showing stale pixels until the next draw → garble until
   you scroll. `reconcileRenderers` doesn't help: the pane already had `entry.webgl`, so `acquireWebgl`
   early-returns and never repaints. **This is where PR #3's `repairRenderers` should have been called
   and wasn't.**
2. **H1 fires too — box-shadow appears on the first split.** `isSplit` flips false→true, so
   `.terminal-pane.focused`/`.waiting` (`App.css:541,544`) now applies a `box-shadow` on the
   canvas's container → recompositing over the WebGL layer (see H1 below).

So a split = reparent-without-repaint **+** box-shadow-appears, both hitting the same canvas. Fix both:
**(a)** repaint on attach, **(b)** isolate the canvas layer / move the rail. See F0 + F1 below.

## Root cause — ranked hypotheses (with evidence)

### H1 — `box-shadow` toggled on the WebGL-canvas container (PRIMARY, high confidence)

The pane element that carries the focus/attention rail **is the ancestor of the WebGL canvas**, and
we toggle a `box-shadow` on it:

- `src/components/terminal-pane.tsx:63` → `<div className={\`terminal-pane${railClass}\`}>`
- `src/components/terminal-pane.tsx:109` → `<div className="terminal-mount" ref={mountRef} />` (xterm
  WebGL canvas mounts **inside** this)
- `src/App.css:541` → `.terminal-pane.focused { box-shadow: inset 0 2px 0 var(--accent); }`
- `src/App.css:544` → `.terminal-pane.waiting { box-shadow: inset 0 2px 0 var(--amber); }`

**This is the exact trap `GOTCHAS.md#renderer` warns about** — a compositing property changing on the
element that holds the WebGL canvas leaves the canvas showing stale/garbled glyphs. The rail was
_supposed_ to be "a non-compositing indicator … not the terminal's container"; instead it's a
`box-shadow` directly on `.terminal-pane`.

**Why it fires constantly with Claude Code:** `railClass` (`terminal-pane.tsx`, the `focused`/`waiting`
logic) flips to `waiting` whenever `session.status === "attention"`, and back to `focused`/none when
working — and an agent conversation flips that status repeatedly (output-idle → attention → working →
…). Each flip toggles the `box-shadow` → the browser recomposites that layer → the child WebGL canvas
garbles. No focus/DPR/resize event, so PR #3's repair never runs.

**Prediction to confirm it:** the garble should correlate with **split tabs** (railClass is gated on
`isSplit` — see `terminal-pane.tsx`), and with **status changes** (an agent going idle/active), not
with backgrounding. If you see it in split panes while Claude flips between "working" and "needs
input", that's H1.

### H2 — React re-render churn on every status flip (contributes to lag)

`TerminalPane` subscribes to `session`, `focused`, `status`, `isSplit` via `useStore` selectors
(`terminal-pane.tsx:12–24`). Every `signalSession` (throttled to ~150 ms on output, plus
output-idle/attention/command marks) mutates the session → the whole `TerminalPane` re-renders. The
terminal itself lives outside React (safe), but the header re-renders and — via H1 — the pane
recomposites. Under Claude Code streaming this is a steady drip of re-render + recomposite = felt lag.

### H3 — WebGL atlas rasterization of Claude Code's glyph set (possible; explains single-pane garble)

Claude Code prints a heavy glyph set: spinners (`⠋⠙…`), box-drawing, Powerline, emoji, syntax colors.
xterm's WebGL addon (`@xterm/addon-webgl ^0.19.0`, `@xterm/xterm ^6.0.0`) rasterizes glyphs into a GPU
texture atlas; complex/wide/emoji glyphs and frequent atlas growth are its historically weak spot
(the #3303 / #4379 family this repo already cites). If garble appears in a **single, unsplit** pane
(where H1 can't fire), this is the likely cause.

### H4 — redraw throughput under streaming (secondary, for the lag)

High-frequency full-screen redraws (token streaming, spinner, re-drawing the input box + highlighted
diffs) = many `term.write` → parse → WebGL draw. IPC is already coalesced (`electron/coalescer.ts`,
PERF.md), so the main→renderer hop isn't the bottleneck; the renderer-side draw + any atlas rebuild is.
Likely amplifies H1/H2 rather than being the sole cause.

## Diagnostic plan (confirm which before fixing)

1. **Does garble track splits + status flips?** Run Claude in a split pane; watch it garble as status
   goes working↔attention. → confirms **H1**.
2. **Kill the trigger, see if garble stops.** Temporarily either (a) remove the `.focused`/`.waiting`
   `box-shadow`, or (b) isolate the canvas layer so a parent recomposite can't touch it — add to
   `.terminal-mount` (or `.terminal-host`): `contain: paint;` and/or `isolation: isolate;` (and test
   `will-change: transform` on the canvas). If garble stops → **H1 confirmed** and (b) may be the fix.
3. **Force the DOM renderer** (skip `acquireWebgl`): if garble disappears (but ligatures/speed regress)
   → the WebGL renderer/atlas is implicated (**H3**), independent of H1.
4. **Measure during streaming** with the `SMTERM_PERF=1` harness (PERF.md) — renderer CPU + frame cost
   while an agent streams, split vs single, to size **H2/H4**.

## Fix ideas (ranked)

### F0 — Repaint the WebGL canvas after a reparent (addresses H5; the "on split" cure)

Wire the existing repair into the reparent path: at the end of `attach()` (after
`reconcileRenderers()`), repaint the (re)attached pane on the next frame —
`requestAnimationFrame(() => repairRenderers())` (deferred so it runs after the browser lays out the
moved canvas). This is precisely the trigger PR #3 forgot. Cheap, reuses existing code, and targets the
exact "garble just after split" symptom.

### F1 — Stop compositing over the WebGL canvas (addresses H1; do this first)

Two independent options, cheapest first:

- **F1a — isolate the canvas layer.** Add `contain: paint` / `isolation: isolate` to `.terminal-mount`
  (or `.terminal-host`) so box-shadow/paint changes on the ancestor `.terminal-pane` can't repaint the
  canvas's layer. One-line CSS; may fully fix H1 while keeping the current rail look. **Test first.**
- **F1b — move the indicator off the container (matches the gotcha's prescription).** Render the
  focus/attention bar as a **separate absolutely-positioned overlay element** (its own 2px bar at the
  pane top, `position:absolute; top:0`), a sibling of `.terminal-mount`, so toggling it never
  recomposites the canvas's layer. This is the "non-compositing indicator" `GOTCHAS#renderer` already
  calls for. More code than F1a but structurally correct.

Recommendation: try **F1a** (one line) → if it fully cures the garble, ship it; else do **F1b**.

### F2 — Cut status-driven re-render/recomposite (addresses H2)

- Split `TerminalPane` so the **status-bearing header/rail is its own memoized child** subscribing to
  status, and the container + mount don't re-render on status. Combined with F1, the pane container
  stops churning entirely.
- Consider raising the output-signal throttle (currently ~150 ms in `terminal-manager` `spawn`) or
  coalescing status transitions, so an idle→active flurry doesn't thrash.

### F3 — If garble persists single-pane (H3)

- A/B the **renderer**: confirm whether disabling WebGL (DOM renderer) removes it. If so, evaluate:
  (a) pin/upgrade `@xterm/addon-webgl` (atlas fixes land often), (b) the canvas renderer, or (c) keep
  WebGL but call `webgl.clearTextureAtlas()` on a cheaper trigger. Trade-off: DOM/canvas loses
  ligatures + speed (the reason WebGL was chosen).

### F4 — Throughput (H4, if the lag survives F1/F2)

- Revisit the deferred PERF candidate: **flow control** (pause `node-pty` when the renderer lags) +
  N-busy-pane scaling, measured against the PERF.md baselines.

## Recommendation

Start with **F1a** (isolate the canvas layer — one line) and re-test the garble; it directly targets
the confirmed H1 mechanism and is nearly free. If garble remains in single-pane use, run diagnostic #3
to separate H3. Tackle the lag with **F2** (memoized status header) once F1 stops the recomposite —
they're the same root (status churn hitting the pane container), so F1+F2 likely address both symptoms
together. `GOTCHAS#renderer` should then be updated to note the rail must be an overlay, not a
`box-shadow` on `.terminal-pane`.
