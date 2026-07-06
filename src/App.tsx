import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke, Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily:
        'Menlo, Monaco, "Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    // Clicking a detected URL opens it in the OS default browser (no embedded browser).
    term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));

    term.open(el);
    fit.fit();

    const id = crypto.randomUUID();

    // Backend -> frontend: stream of raw PTY bytes.
    const onData = new Channel<number[]>();
    onData.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    invoke("pty_spawn", { id, cols: term.cols, rows: term.rows, onData }).catch(
      (e) => term.write(`\r\n\x1b[31m[spawn error] ${e}\x1b[0m\r\n`),
    );

    // Frontend -> backend: keystrokes / pasted text.
    const dataSub = term.onData((data) => {
      void invoke("pty_write", { id, data });
    });

    const doResize = () => {
      fit.fit();
      void invoke("pty_resize", { id, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(doResize);
    ro.observe(el);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      void invoke("pty_kill", { id });
      term.dispose();
    };
  }, []);

  return <div className="term-root" ref={containerRef} />;
}

export default App;
