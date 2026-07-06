import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabBar } from "./components/TabBar";
import { PaneLayout } from "./components/PaneLayout";
import { TerminalManager } from "./terminal/TerminalManager";
import { useStore } from "./store";
import type { ShellOption } from "./types";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

function App() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);

  // Load available shells once, then open the first tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let shells: ShellOption[] = [];
      try {
        shells = await invoke<ShellOption[]>("list_shells");
      } catch {
        // Running without a backend (e.g. plain browser) — fall through.
      }
      if (cancelled) return;
      if (shells.length === 0) {
        shells = [{ id: "default", label: "shell", command: "", args: [] }];
      }
      const store = useStore.getState();
      store.setShells(shells);
      if (store.tabs.length === 0 && shells[0]) store.newTab(shells[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dispose terminals whose sessions have left the store (pane/tab closed).
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      const current = new Set(Object.keys(state.sessions));
      for (const id of Object.keys(prev.sessions)) {
        if (!current.has(id)) TerminalManager.dispose(id);
      }
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app">
      <TabBar />
      <div className="content">
        {activeTab ? (
          <PaneLayout key={activeTab.id} node={activeTab.root} tabId={activeTab.id} />
        ) : (
          <div className="empty">No sessions — open a tab.</div>
        )}
      </div>
    </div>
  );
}

export default App;
