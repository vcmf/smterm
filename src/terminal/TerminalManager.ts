import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { CanvasAddon } from "@xterm/addon-canvas";
import { invoke, Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "../types";
import { useStore, isSessionVisible } from "../store";
import { notify } from "../lib/notify";
import { getTheme } from "../settings/themes";
import type { Settings } from "../settings/schema";
import { ligatureRanges } from "./ligatures";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
  joinerId: number | undefined;
}

// xterm.js + PTY live here, keyed by session id — OUTSIDE the React tree, so
// splitting a pane or switching tabs re-attaches instead of respawning the shell.
const entries = new Map<string, Entry>();

const fontStack = (family: string) => `"${family}", Menlo, "Cascadia Code", monospace`;

function build(): Entry {
  const s = useStore.getState().settings;
  const host = document.createElement("div");
  host.className = "terminal-host";
  const term = new Terminal({
    fontFamily: fontStack(s.font.family),
    fontSize: s.font.size,
    lineHeight: s.font.lineHeight,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
    theme: getTheme(s.theme).terminal,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Clicking a URL opens it in the OS default browser (no embedded browser).
  term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
  return { term, fit, host, opened: false, joinerId: undefined };
}

/** Register/deregister the ligature character joiner to match the setting. */
function applyLigatures(entry: Entry, on: boolean) {
  if (on && entry.joinerId === undefined) {
    entry.joinerId = entry.term.registerCharacterJoiner(ligatureRanges);
  } else if (!on && entry.joinerId !== undefined) {
    entry.term.deregisterCharacterJoiner(entry.joinerId);
    entry.joinerId = undefined;
  }
}

function spawn(session: Session, entry: Entry) {
  const { term } = entry;
  const store = useStore.getState();

  const onData = new Channel<number[]>();
  onData.onmessage = (bytes) => {
    term.write(new Uint8Array(bytes));
    const s = useStore.getState().sessions[session.id];
    if (s && !s.unread && !isSessionVisible(session.id)) {
      store.signalSession(session.id, { type: "output" });
    }
  };

  invoke("pty_spawn", {
    id: session.id,
    cols: term.cols,
    rows: term.rows,
    shell: session.command,
    args: session.args,
    onData,
  }).catch((e) => term.write(`\r\n\x1b[31m[spawn error] ${e}\x1b[0m\r\n`));

  term.onData((data) => void invoke("pty_write", { id: session.id, data }));

  // OSC 9 — attention; OSC 133;C/D — command start/finish.
  term.parser.registerOscHandler(9, (data) => {
    store.signalSession(session.id, { type: "attention" });
    if (!isSessionVisible(session.id)) void notify(session.title, data || "smterm");
    return true;
  });
  term.parser.registerOscHandler(133, (data) => {
    const kind = data.charAt(0);
    if (kind === "C") store.signalSession(session.id, { type: "command-start" });
    else if (kind === "D") store.signalSession(session.id, { type: "command-end" });
    return true;
  });
}

function syncSize(id: string, entry: Entry) {
  try {
    entry.fit.fit();
    void invoke("pty_resize", { id, cols: entry.term.cols, rows: entry.term.rows });
  } catch {
    // Container not measurable yet; a later fit() call will settle it.
  }
}

export const TerminalManager = {
  /** Mount a session's terminal into `container`, creating + spawning on first use. */
  attach(session: Session, container: HTMLElement) {
    let entry = entries.get(session.id);
    if (!entry) {
      entry = build();
      entries.set(session.id, entry);
    }
    container.appendChild(entry.host);
    if (!entry.opened) {
      entry.term.open(entry.host);
      entry.opened = true;
      // Canvas renderer supports character joiners (needed for ligatures).
      try {
        entry.term.loadAddon(new CanvasAddon());
      } catch {
        // Falls back to the DOM renderer; ligatures won't render but term works.
      }
      applyLigatures(entry, useStore.getState().settings.font.ligatures);
      syncSize(session.id, entry);
      spawn(session, entry);
    } else {
      syncSize(session.id, entry);
    }
    entry.term.focus();
  },

  fit(id: string) {
    const entry = entries.get(id);
    if (entry?.opened) syncSize(id, entry);
  },

  focus(id: string) {
    entries.get(id)?.term.focus();
  },

  /** Apply settings (font/theme/ligatures/etc.) to every live terminal. */
  applySettings(settings: Settings) {
    const theme = getTheme(settings.theme).terminal;
    for (const [id, entry] of entries) {
      const o = entry.term.options;
      o.fontFamily = fontStack(settings.font.family);
      o.fontSize = settings.font.size;
      o.lineHeight = settings.font.lineHeight;
      o.cursorBlink = settings.cursorBlink;
      o.scrollback = settings.scrollback;
      o.theme = theme;
      applyLigatures(entry, settings.font.ligatures);
      if (entry.opened) syncSize(id, entry);
    }
  },

  dispose(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    void invoke("pty_kill", { id });
    entry.term.dispose();
    entry.host.remove();
    entries.delete(id);
  },
};
