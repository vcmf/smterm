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
import { shouldUseWebgl } from "../lib/renderer-policy"
import { keyAction } from "../lib/terminal-keys"

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

/** Start rendering this terminal via WebGL (GPU-fast, ligature-capable). */
function acquireWebgl(entry: Entry) {
  if (entry.webgl || entry.webglFailed || !entry.opened) return
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      // Context lost (GPU pressure / suspend) — drop to DOM and don't retry it.
      webgl.dispose()
      entry.webgl = undefined
      entry.webglFailed = true
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
  } catch {
    entry.webglFailed = true // no WebGL2 — stay on the DOM renderer
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
}

/** WebGL only for the panes currently on-screen (active tab), and only when few
 *  enough share the screen (else DOM). Keeps live GPU contexts to a safe minimum
 *  — many simultaneous WebGL contexts corrupt the glyph atlas. */
function reconcileRenderers() {
  const state = useStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const visible = new Set(tab ? allSessionIds(tab.root) : [])
  const useWebgl = shouldUseWebgl(visible.size)
  for (const [id, entry] of entries) {
    if (!entry.opened) continue
    if (useWebgl && visible.has(id)) acquireWebgl(entry)
    else releaseWebgl(entry)
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
      void ipc.clipboardRead().then((text) => text && term.paste(text))
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
}

function syncSize(id: string, entry: Entry) {
  try {
    entry.fit.fit()
    ipc.ptyResize(id, entry.term.cols, entry.term.rows)
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
      applyLigatures(entry, useStore.getState().settings.font.ligatures)
      syncSize(session.id, entry)
      spawn(session, entry)
    } else {
      syncSize(session.id, entry)
    }
    reconcileRenderers() // this pane is now on-screen — (re)acquire WebGL if apt
    entry.term.focus()
  },

  reconcileRenderers,

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
    if (entry) void ipc.clipboardRead().then((text) => text && entry.term.paste(text))
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
