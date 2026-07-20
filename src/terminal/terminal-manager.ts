import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search"
import type { Session } from "../types"
import { useStore } from "../store"
import { notify } from "../lib/notify"
import { ipc } from "../lib/ipc"
import { getTheme } from "../settings/themes"
import type { Settings } from "../settings/schema"
import { ligatureRanges } from "./ligatures"
import { displaySessionTitle } from "../lib/session-label"
import { allSessionIds } from "../lib/pane-tree"
import { webglPanes, shouldRebuildAtlas } from "../lib/renderer-policy"
import { keyAction, pasteAction } from "../lib/terminal-keys"
import { gridChanged, type Grid } from "../lib/resize"
import { findFilePaths } from "../lib/file-links"

const isMac = /mac/i.test(navigator.userAgent)

interface Entry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  host: HTMLDivElement
  opened: boolean
  offData?: () => void
  joinerId?: number
  idleTimer?: ReturnType<typeof setTimeout>
  lastOutputSignal?: number
  lastGrid?: Grid // last cols/rows sent to the PTY — skip no-op resizes (spurious SIGWINCH)
  webgl?: WebglAddon // present only while this terminal is rendering via WebGL
  webglFailed?: boolean // context was lost — stay on DOM, don't re-acquire
}

// Output quiet for this long (while a command runs) ⇒ the task is waiting.
const IDLE_MS = 1200
// Don't spam the store with an "output" signal on every PTY chunk.
const OUTPUT_SIGNAL_THROTTLE_MS = 150

// xterm.js lives here, keyed by session id — OUTSIDE the React tree, so splitting
// a pane or switching tabs re-attaches instead of respawning the shell.
const entries = new Map<string, Entry>()

// Set while WE call term.focus() programmatically (attach/mount/reparent) so the
// textarea focus listener ignores it — only genuine user focus should change the
// active pane. Otherwise a tab-switch/split mount storm would clobber the active pane.
let suppressFocusSignal = false

// File-link existence cache: the link provider fires on hover, so cache validated
// paths briefly to avoid re-stat'ing the same line via IPC on every mouse move.
const pathExistsCache = new Map<string, { ok: boolean; ts: number }>()
const PATH_CACHE_TTL_MS = 5000
const PATH_CACHE_MAX = 1000 // bound memory over long sessions (many distinct paths)
function validatePath(cwd: string, p: string): Promise<boolean> {
  const key = `${cwd} ${p}`
  const hit = pathExistsCache.get(key)
  const now = performance.now()
  if (hit && now - hit.ts < PATH_CACHE_TTL_MS) return Promise.resolve(hit.ok)
  return ipc.pathExists(cwd, p).then((ok) => {
    pathExistsCache.set(key, { ok, ts: now })
    // Evict the oldest entry once over the cap (Map keeps insertion order) so the
    // cache can't grow unbounded as an agent prints thousands of distinct paths.
    if (pathExistsCache.size > PATH_CACHE_MAX) {
      const oldest = pathExistsCache.keys().next().value
      if (oldest !== undefined) pathExistsCache.delete(oldest)
    }
    return ok
  })
}

// Bundled FiraCode Nerd Font Mono carries text + ligatures + Nerd/Powerline icons.
const fontStack = (family: string) =>
  `"${family}", "FiraCode Nerd Font Mono", "JetBrains Mono", Menlo, monospace`

// Explicitly load the terminal font (regular + bold) so canvas — and thus the
// WebGL glyph atlas — can rasterize its Nerd/box glyphs. `document.fonts.ready`
// is not enough: it won't load an unused `font-display:block` @font-face.
function ensureFontLoaded(family: string, size: number): Promise<unknown> {
  return Promise.all(
    [`${size}px ${family}`, `bold ${size}px ${family}`].map((spec) =>
      document.fonts.load(spec).catch(() => undefined),
    ),
  )
}

// Paste into a terminal. Text on the clipboard → normal paste. An image with no text
// (e.g. a screenshot) → send Ctrl+V (0x16) so the running program (Claude Code, etc.)
// reads the image from the clipboard itself — the same path as pressing Ctrl+V. Without
// this, ⌘V text-pastes an empty string and the image is dropped; this makes ⌘V attach
// images in Claude, matching cmux. In a plain shell 0x16 is quoted-insert (the line
// editor waits for the next key; recover with Ctrl+C) — identical to pressing Ctrl+V there.
function pasteInto(term: Terminal) {
  void Promise.all([ipc.clipboardRead(), ipc.clipboardHasImage()]).then(([text, hasImage]) => {
    const action = pasteAction(text, hasImage)
    if (action === "text") term.paste(text)
    else if (action === "image") term.input("\x16")
  })
}

/** Give this pane a WebGL context if it doesn't have one. Returns true if a context
 *  was newly created (so the caller can rebuild the shared atlas across panes). */
function acquireWebgl(entry: Entry): boolean {
  if (entry.webgl || entry.webglFailed || !entry.opened) return false
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      // Context lost — GPU pressure, another pane creating a context on split (browsers
      // cap live WebGL contexts and evict the oldest), or the host being reparented.
      // Drop to DOM and don't retry. CRUCIAL: repaint. Disposing WebGL stops it drawing
      // and the DOM renderer starts empty, so without this the pane goes BLANK (the
      // buffer is intact — it just isn't painted). Repaint next frame, once DOM is live.
      webgl.dispose()
      entry.webgl = undefined
      entry.webglFailed = true
      requestAnimationFrame(() => {
        try {
          entry.term.refresh(0, entry.term.rows - 1)
        } catch {
          // terminal disposed meanwhile
        }
      })
    })
    entry.term.loadAddon(webgl)
    entry.webgl = webgl
    // The WebGL atlas rasterizes glyphs via canvas, which only uses an @font-face
    // AFTER it's explicitly loaded — `document.fonts.ready` isn't enough. Load it,
    // then clear the atlas + repaint so early/stale glyphs re-rasterize cleanly.
    const s = useStore.getState().settings
    void ensureFontLoaded(fontStack(s.font.family), s.font.size).then(() => {
      try {
        webgl.clearTextureAtlas()
        entry.term.refresh(0, entry.term.rows - 1)
      } catch {
        // addon disposed meanwhile
      }
    })
    return true
  } catch {
    entry.webglFailed = true // no WebGL2 — stay on the DOM renderer
    return false
  }
}

/** Stop rendering via WebGL; xterm reverts to the DOM renderer (keeps the PTY). */
function releaseWebgl(entry: Entry) {
  if (!entry.webgl) return
  try {
    entry.webgl.dispose()
  } catch {
    // already gone
  }
  entry.webgl = undefined
  // Reverting to the DOM renderer stops the WebGL canvas painting; repaint so the
  // pane isn't left blank (next frame, once DOM has taken over).
  requestAnimationFrame(() => {
    try {
      entry.term.refresh(0, entry.term.rows - 1)
    } catch {
      // disposed meanwhile
    }
  })
}

/** WebGL only for the panes currently on-screen (active tab), and only when few
 *  enough share the screen (else DOM). Keeps live GPU contexts to a safe minimum
 *  — many simultaneous WebGL contexts corrupt the glyph atlas. */
function reconcileRenderers() {
  const state = useStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const visible = tab ? allSessionIds(tab.root) : []
  // Which panes get a live GPU context. Default (`auto`) is the focused pane only —
  // one context can't corrupt itself, so the multi-pane split garble is impossible
  // by construction (see GOTCHAS #renderer). `webgl` = all visible; `dom` = none.
  const webgl = webglPanes(state.settings.renderer, visible)
  let created = false
  for (const [id, entry] of entries) {
    if (!entry.opened) continue
    if (webgl.has(id)) created = acquireWebgl(entry) || created
    else releaseWebgl(entry)
  }
  // Creating a WebGL context can disturb the sibling contexts that share xterm's
  // glyph atlas (garble on split with several panes — xterm.js #4379). Once the new
  // context has settled, rebuild the atlas on ALL live WebGL panes so any corrupted
  // glyphs re-rasterize. Deferred a frame so the new context is fully initialised.
  if (shouldRebuildAtlas(created, webgl.size)) {
    requestAnimationFrame(() => repairRenderers(true))
  }
}

/** Repaint on-screen WebGL panes — mirrors what a manual scroll does, forcing
 *  xterm to re-emit rows the GPU may be showing stale. Pass `rebuildAtlas` when
 *  render metrics changed (DPR / monitor / display-scale / resize) so the glyph
 *  atlas is rebuilt at the new size, not just repainted. Cures the rare WebGL
 *  atlas/framebuffer garble after backgrounding or a display change — the "it
 *  fixes itself when I scroll" symptom. See GOTCHAS #renderer. */
function repairRenderers(rebuildAtlas = false) {
  for (const entry of entries.values()) {
    if (!entry.webgl || !entry.opened) continue
    try {
      if (rebuildAtlas) entry.webgl.clearTextureAtlas()
      entry.term.refresh(0, entry.term.rows - 1)
    } catch {
      // addon disposed meanwhile — ignore
    }
  }
}

function build(): Entry {
  const s = useStore.getState().settings
  const host = document.createElement("div")
  host.className = "terminal-host"
  const term = new Terminal({
    allowProposedApi: true, // for registerCharacterJoiner (ligatures)
    fontFamily: fontStack(s.font.family),
    fontSize: s.font.size,
    lineHeight: s.font.lineHeight,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
    // Snappier scrollback feel (xterm defaults to 1 line/tick, no smoothing — reads as
    // sluggish vs VS Code/cmux). More lines per wheel/trackpad tick + a short glide.
    scrollSensitivity: 3,
    fastScrollSensitivity: 12, // Alt-scroll
    smoothScrollDuration: 100, // ms; modest — higher starts to feel laggy
    theme: getTheme(s.theme).terminal,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  // Clicking a URL opens it in the OS default browser (no embedded browser).
  term.loadAddon(new WebLinksAddon((_event, uri) => ipc.openExternal(uri)))
  // Copy / paste / select-all. Returning false stops xterm from also processing
  // the key; preventDefault stops the browser's native copy/paste (avoids a double
  // paste). Everything else (incl. ⌃C SIGINT) passes straight through to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true
    const action = keyAction(e, { isMac, hasSelection: term.hasSelection() })
    if (!action) return true
    if (action === "copy") {
      const sel = term.getSelection()
      if (sel) ipc.clipboardWrite(sel)
      // Windows/Linux plain Ctrl+C copies-when-selected; clear the selection so an
      // immediate second Ctrl+C sends SIGINT instead of re-copying.
      if (!isMac && e.ctrlKey && !e.shiftKey) term.clearSelection()
    } else if (action === "paste") {
      pasteInto(term)
    } else if (action === "newline") {
      // Gated so it can be turned off if a plain shell doesn't decode CSI-u; default
      // on (works with Claude Code & other agent CLIs). Off → let xterm submit normally.
      if (!useStore.getState().settings.shiftEnterNewline) return true
      // CSI-u encoding of Shift+Enter — apps that speak it insert a newline instead of
      // submitting. `input()` routes through onData → the PTY.
      term.input("\x1b[13;2u")
    } else {
      term.selectAll()
    }
    e.preventDefault()
    return false
  })
  return { term, fit, search, host, opened: false }
}

// Search match highlighting — amber for all matches, orange for the active one
// (translucent so text stays readable; solid on the overview ruler).
function searchOptions(caseSensitive: boolean, incremental: boolean): ISearchOptions {
  return {
    caseSensitive,
    incremental, // type-as-you-go: keep the current match instead of jumping ahead
    decorations: {
      matchBackground: "rgba(255, 213, 79, 0.35)",
      matchBorder: "rgba(255, 213, 79, 0.9)",
      matchOverviewRuler: "#ffd54f",
      activeMatchBackground: "rgba(255, 152, 0, 0.55)",
      activeMatchBorder: "rgba(255, 152, 0, 1)",
      activeMatchColorOverviewRuler: "#ff9800",
    },
  }
}

/** Register/deregister the ligature character joiner to match the setting. */
function applyLigatures(entry: Entry, on: boolean) {
  if (on && entry.joinerId === undefined) {
    entry.joinerId = entry.term.registerCharacterJoiner(ligatureRanges)
  } else if (!on && entry.joinerId !== undefined) {
    entry.term.deregisterCharacterJoiner(entry.joinerId)
    entry.joinerId = undefined
  }
}

function spawn(session: Session, entry: Entry) {
  const { term } = entry
  const store = useStore.getState()

  entry.offData = ipc.onPtyData(session.id, (bytes) => {
    term.write(bytes)
    // Generic agent-status heuristic: throttled "output" signal + an idle timer.
    // While a command runs, streaming keeps it "working"; when output goes quiet
    // for IDLE_MS the timer flips it to "attention" (agent waiting for input).
    const now = performance.now()
    if (now - (entry.lastOutputSignal ?? 0) > OUTPUT_SIGNAL_THROTTLE_MS) {
      entry.lastOutputSignal = now
      store.signalSession(session.id, { type: "output" })
    }
    clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      useStore.getState().signalSession(session.id, { type: "output-idle" })
    }, IDLE_MS)
  })

  void ipc
    .ptySpawn({
      id: session.id,
      cols: term.cols,
      rows: term.rows,
      shell: session.command,
      args: session.args,
      cwd: session.cwd, // inherited from the pane this was split/opened from
    })
    .catch((e) => term.write(`\r\n\x1b[31m[spawn error] ${e}\x1b[0m\r\n`))

  term.onData((data) => ipc.ptyWrite(session.id, data))

  // OSC 0/2 (window title) → live session title (shells set it to cmd/cwd;
  // agents like Claude Code can set it to the task). Manual rename still wins
  // at the tab level (store keeps tab.title as the pin).
  term.onTitleChange((title) => store.setSessionOscTitle(session.id, title))

  // OSC 7 — the shell reports its working directory (file://host/path).
  term.parser.registerOscHandler(7, (data) => {
    try {
      const path = decodeURIComponent(new URL(data).pathname)
      if (path) store.setSessionCwd(session.id, path)
    } catch {
      // malformed URL — ignore
    }
    return true
  })

  // A program asks for attention (OSC 9 message, or the terminal bell). Notify
  // only on the transition into attention (de-noise) and only when off-screen.
  const raiseAttention = (detail?: string) => {
    const wasAttention = useStore.getState().sessions[session.id]?.status === "attention"
    store.signalSession(session.id, { type: "attention", detail })
    // OS notification only when you're away from the app (the dot/bell cover the
    // in-app case), and only on the transition into attention (de-noise).
    if (!useStore.getState().windowFocused && !wasAttention) {
      const s = useStore.getState().sessions[session.id]
      const home = useStore.getState().home
      void notify(displaySessionTitle(s, home), detail || "wants your attention")
    }
  }

  // OSC 9 — desktop-notification escape (its text is the reason).
  term.parser.registerOscHandler(9, (data) => {
    raiseAttention(data || undefined)
    return true
  })
  // Terminal bell — a generic "waiting on you" from readline/prompts/agents.
  term.onBell(() => raiseAttention())

  // OSC 133;C/D — command start/finish.
  term.parser.registerOscHandler(133, (data) => {
    const kind = data.charAt(0)
    if (kind === "C") store.signalSession(session.id, { type: "command-start" })
    else if (kind === "D") {
      // Command finished at the prompt — precise idle; cancel the heuristic timer
      // so it can't later mis-flip this settled session to "attention".
      clearTimeout(entry.idleTimer)
      store.signalSession(session.id, { type: "command-end" })
    }
    return true
  })

  // Clickable file links: detect path-like tokens on the hovered row, validate they
  // exist against the session cwd (kills false positives — versions, domains, etc.
  // that don't resolve to a file), and open on Cmd/Ctrl-click. Single-row for now.
  if (useStore.getState().settings.fileLinks) {
    term.registerLinkProvider({
      provideLinks(y, cb) {
        const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ""
        const cwd = useStore.getState().sessions[session.id]?.cwd
        const matches = cwd ? findFilePaths(text) : []
        if (!cwd || matches.length === 0) return cb(undefined)
        void Promise.all(matches.map((m) => validatePath(cwd, m.path)))
          .then((oks) => {
            const links = matches
              .filter((_, i) => oks[i])
              .map((m) => ({
                text: text.slice(m.start, m.start + m.length),
                range: { start: { x: m.start + 1, y }, end: { x: m.start + m.length, y } },
                decorations: { pointerCursor: true, underline: true },
                activate: (e: MouseEvent) => {
                  if (!e.metaKey && !e.ctrlKey) return // Cmd/Ctrl-click only (reduces noise)
                  ipc.openFile(cwd, m.path, m.line, m.col)
                },
              }))
            cb(links.length ? links : undefined)
          })
          .catch(() => cb(undefined))
      },
    })
  }
}

function syncSize(id: string, entry: Entry) {
  try {
    entry.fit.fit()
    const { cols, rows } = entry.term
    // Only resize the PTY when the character grid actually changed. A split/layout
    // reflow can fire ResizeObserver without changing a pane's grid; resizing anyway
    // would SIGWINCH the running program and make it redraw for nothing.
    if (gridChanged(entry.lastGrid, cols, rows)) {
      entry.lastGrid = { cols, rows }
      ipc.ptyResize(id, cols, rows)
    }
  } catch {
    // Container not measurable yet; a later fit() call will settle it.
  }
}

export const TerminalManager = {
  /** Mount a session's terminal into `container`, creating + spawning on first use. */
  attach(session: Session, container: HTMLElement) {
    let entry = entries.get(session.id)
    if (!entry) {
      entry = build()
      entries.set(session.id, entry)
    }
    container.appendChild(entry.host)
    if (!entry.opened) {
      entry.term.open(entry.host) // DOM renderer by default; WebGL added by reconcile
      entry.opened = true
      // Make this pane active whenever its terminal actually gains focus (click or
      // keyboard). This is the reliable signal: a mousedown handler on the pane
      // container misses clicks inside an agent TUI (mouse-tracking on), because
      // xterm's selection service stopPropagation()s those mousedowns — which left
      // the active pane stuck on the last-added one, so splits targeted the wrong pane.
      entry.term.textarea?.addEventListener("focus", () => {
        if (suppressFocusSignal) return
        useStore.getState().focusSession(session.id)
      })
      applyLigatures(entry, useStore.getState().settings.font.ligatures)
      syncSize(session.id, entry)
      spawn(session, entry)
    } else {
      syncSize(session.id, entry)
    }
    reconcileRenderers() // this pane is now on-screen — (re)acquire WebGL if apt
    // Programmatic focus on (re)attach — don't let it change the active pane (a split
    // or tab-switch mounts several panes; the store already knows which is active).
    suppressFocusSignal = true
    entry.term.focus()
    suppressFocusSignal = false
    // Reparenting the host (e.g. on split) moves the live WebGL canvas, which then
    // shows stale/garbled pixels until the next draw. Repaint on the next frame,
    // once the moved canvas has laid out. (This is the trigger PR #3's repair missed.)
    requestAnimationFrame(() => repairRenderers())
  },

  reconcileRenderers,
  repairRenderers,

  fit(id: string) {
    const entry = entries.get(id)
    if (entry?.opened) syncSize(id, entry)
  },

  focus(id: string) {
    entries.get(id)?.term.focus()
  },

  // Clipboard actions for the pane context menu (keyboard is handled in build()).
  hasSelection(id: string): boolean {
    return entries.get(id)?.term.hasSelection() ?? false
  },
  copySelection(id: string) {
    const sel = entries.get(id)?.term.getSelection()
    if (sel) ipc.clipboardWrite(sel)
  },
  paste(id: string) {
    const entry = entries.get(id)
    if (entry) pasteInto(entry.term)
  },
  selectAll(id: string) {
    entries.get(id)?.term.selectAll()
  },

  // Find-in-scrollback (drives @xterm/addon-search on the focused pane).
  // `incremental` (type-as-you-go) keeps the current match rather than advancing.
  searchNext(id: string, query: string, caseSensitive: boolean, incremental = false) {
    entries.get(id)?.search.findNext(query, searchOptions(caseSensitive, incremental))
  },
  searchPrevious(id: string, query: string, caseSensitive: boolean) {
    entries.get(id)?.search.findPrevious(query, searchOptions(caseSensitive, false))
  },
  clearSearch(id: string) {
    entries.get(id)?.search.clearDecorations()
  },
  /** Subscribe to result counts ({resultIndex, resultCount}); returns an unsubscribe. */
  onSearchResults(id: string, cb: (r: { resultIndex: number; resultCount: number }) => void) {
    const entry = entries.get(id)
    if (!entry) return () => {}
    const d = entry.search.onDidChangeResults(cb)
    return () => d.dispose()
  },

  /** Apply settings (font/theme/etc.) to every live terminal. */
  applySettings(settings: Settings) {
    const theme = getTheme(settings.theme).terminal
    for (const [id, entry] of entries) {
      const o = entry.term.options
      o.fontFamily = fontStack(settings.font.family)
      o.fontSize = settings.font.size
      o.lineHeight = settings.font.lineHeight
      o.cursorBlink = settings.cursorBlink
      o.scrollback = settings.scrollback
      o.theme = theme
      applyLigatures(entry, settings.font.ligatures)
      if (entry.opened) syncSize(id, entry)
    }
    // A `renderer` change (webgl ↔ dom) takes effect live: acquire/release WebGL to
    // match, on the current visible panes.
    reconcileRenderers()
  },

  dispose(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    clearTimeout(entry.idleTimer)
    releaseWebgl(entry)
    entry.offData?.()
    ipc.ptyKill(id)
    entry.term.dispose()
    entry.host.remove()
    entries.delete(id)
  },
}
