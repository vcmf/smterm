import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke, Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Session } from "../types";
import { useStore, isSessionVisible } from "../store";
import { notify } from "../lib/notify";

interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
}

// xterm.js + PTY live here, keyed by session id — OUTSIDE the React tree.
// That way splitting a pane or switching tabs (which remounts React components)
// re-attaches the same terminal instead of destroying and respawning the shell.
const entries = new Map<string, Entry>();

function build(): Entry {
  const host = document.createElement("div");
  host.className = "terminal-host";
  const term = new Terminal({
    fontFamily: 'Menlo, Monaco, "Cascadia Code", "Fira Code", Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#d4d4d4" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Clicking a URL opens it in the OS default browser (no embedded browser).
  term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
  return { term, fit, host, opened: false };
}

function spawn(session: Session, entry: Entry) {
  const { term } = entry;
  const store = useStore.getState();

  const onData = new Channel<number[]>();
  onData.onmessage = (bytes) => {
    term.write(new Uint8Array(bytes));
    // Flag background activity (once) so hidden tabs show an unread dot.
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

  // OSC 9 — a program/agent explicitly asks for attention → toast if off-screen.
  term.parser.registerOscHandler(9, (data) => {
    store.signalSession(session.id, { type: "attention" });
    if (!isSessionVisible(session.id)) void notify(session.title, data || "smterm");
    return true;
  });

  // OSC 133 — shell-integration marks: C = command started, D = finished.
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
    // appendChild moves the node here if it was mounted elsewhere before.
    container.appendChild(entry.host);
    if (!entry.opened) {
      entry.term.open(entry.host);
      entry.opened = true;
      syncSize(session.id, entry);
      spawn(session, entry);
    } else {
      syncSize(session.id, entry);
    }
    entry.term.focus();
  },

  /** Re-fit a session after its container resized. */
  fit(id: string) {
    const entry = entries.get(id);
    if (entry?.opened) syncSize(id, entry);
  },

  /** Focus a session's terminal so keystrokes reach the PTY. */
  focus(id: string) {
    entries.get(id)?.term.focus();
  },

  /** Permanently dispose a session's terminal + kill its PTY. */
  dispose(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    void invoke("pty_kill", { id });
    entry.term.dispose();
    entry.host.remove();
    entries.delete(id);
  },
};
