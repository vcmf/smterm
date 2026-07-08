import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import type { Session } from "../types"
import { useStore, isSessionVisible } from "../store"
import { notify } from "../lib/notify"
import { ipc } from "../lib/ipc"
import { getTheme } from "../settings/themes"
import type { Settings } from "../settings/schema"
import { ligatureRanges } from "./ligatures"

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
  offData?: () => void
  joinerId?: number
  idleTimer?: ReturnType<typeof setTimeout>
  lastOutputSignal?: number
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
  // Clicking a URL opens it in the OS default browser (no embedded browser).
  term.loadAddon(new WebLinksAddon((_event, uri) => ipc.openExternal(uri)))
  return { term, fit, host, opened: false }
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

  // OSC 9 — attention; OSC 133;C/D — command start/finish.
  term.parser.registerOscHandler(9, (data) => {
    store.signalSession(session.id, { type: "attention" })
    if (!isSessionVisible(session.id)) void notify(session.title, data || "smterm")
    return true
  })
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
      entry.term.open(entry.host)
      entry.opened = true
      // WebGL renderer (Chromium): GPU-fast + correct glyphs + supports the
      // ligature joiner. Falls back to the DOM renderer on context loss.
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        entry.term.loadAddon(webgl)
        // The WebGL atlas rasterizes glyphs via canvas, which only uses an
        // @font-face AFTER it's been explicitly loaded — `document.fonts.ready`
        // does NOT load an unused `font-display:block` face. So glyphs a shell
        // paints before the font loads (e.g. p10k's instant-prompt connectors)
        // cache as tofu, and cells the shell never rewrites stay stale. Wait for
        // an explicit load(), THEN clear the atlas + repaint to re-rasterize.
        const e = entry
        const rerender = () => {
          try {
            webgl.clearTextureAtlas()
            e.term.refresh(0, e.term.rows - 1)
          } catch {
            // addon disposed
          }
        }
        const s = useStore.getState().settings
        void ensureFontLoaded(fontStack(s.font.family), s.font.size).then(rerender)
      } catch {
        // DOM renderer fallback.
      }
      applyLigatures(entry, useStore.getState().settings.font.ligatures)
      syncSize(session.id, entry)
      spawn(session, entry)
    } else {
      syncSize(session.id, entry)
    }
    entry.term.focus()
  },

  fit(id: string) {
    const entry = entries.get(id)
    if (entry?.opened) syncSize(id, entry)
  },

  focus(id: string) {
    entries.get(id)?.term.focus()
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
    entry.offData?.()
    ipc.ptyKill(id)
    entry.term.dispose()
    entry.host.remove()
    entries.delete(id)
  },
}
