import { useEffect, useRef } from "react";
import { TerminalManager } from "../terminal/TerminalManager";
import { useStore } from "../store";

/** A mount point for one session's terminal. The terminal itself lives in
 *  TerminalManager, so this component can mount/unmount freely. */
export function TerminalPane({ sessionId, tabId }: { sessionId: string; tabId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const session = useStore.getState().sessions[sessionId];
    if (!session) return;
    TerminalManager.attach(session, el);
    const ro = new ResizeObserver(() => TerminalManager.fit(sessionId));
    ro.observe(el);
    // Do NOT dispose on unmount — the terminal is reused on re-attach.
    // Disposal happens when the session leaves the store (App reconciler).
    return () => ro.disconnect();
  }, [sessionId]);

  return (
    <div
      className="terminal-pane"
      onMouseDown={() => useStore.getState().setActivePane(tabId, sessionId)}
    >
      <button
        className="pane-close"
        title="Close pane"
        onMouseDown={(e) => {
          e.stopPropagation();
          useStore.getState().closePane(tabId, sessionId);
        }}
      >
        ×
      </button>
      <div className="terminal-mount" ref={mountRef} />
    </div>
  );
}
