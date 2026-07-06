import { useState } from "react";
import { useStore } from "../store";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const shells = useStore((s) => s.shells);
  const [shellId, setShellId] = useState<string | null>(null);

  const currentShell = shells.find((s) => s.id === shellId) ?? shells[0];

  return (
    <div className="tabbar">
      <div className="tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeTabId ? " active" : ""}`}
            onMouseDown={() => useStore.getState().setActiveTab(tab.id)}
            onDoubleClick={() => {
              const name = window.prompt("Rename tab", tab.title);
              if (name) useStore.getState().renameTab(tab.id, name);
            }}
          >
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              title="Close tab"
              onMouseDown={(e) => {
                e.stopPropagation();
                useStore.getState().closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <select
          className="shell-select"
          value={currentShell?.id ?? ""}
          onChange={(e) => setShellId(e.target.value)}
        >
          {shells.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className="tb-btn"
          title="New tab"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().newTab(currentShell)}
        >
          + Tab
        </button>
        <button
          className="tb-btn"
          title="Split right"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().splitActive("row", currentShell)}
        >
          ⬌
        </button>
        <button
          className="tb-btn"
          title="Split down"
          disabled={!currentShell}
          onClick={() => currentShell && useStore.getState().splitActive("column", currentShell)}
        >
          ⬍
        </button>
      </div>
    </div>
  );
}
