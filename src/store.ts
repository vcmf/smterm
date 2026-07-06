import { create } from "zustand";
import type { PaneNode, Session, ShellOption, Tab } from "./types";
import { allSessionIds, firstSessionId, makeLeaf, removeNode, splitNode } from "./lib/paneTree";

const newId = () => crypto.randomUUID();

function makeSession(shell: ShellOption): Session {
  return { id: newId(), title: shell.label, command: shell.command, args: shell.args };
}

interface AppState {
  sessions: Record<string, Session>;
  tabs: Tab[];
  activeTabId: string | null;
  shells: ShellOption[];

  setShells: (shells: ShellOption[]) => void;
  newTab: (shell: ShellOption) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  splitActive: (direction: "row" | "column", shell: ShellOption) => void;
  closePane: (tabId: string, sessionId: string) => void;
  setActivePane: (tabId: string, sessionId: string) => void;
}

export const useStore = create<AppState>((set) => ({
  sessions: {},
  tabs: [],
  activeTabId: null,
  shells: [],

  setShells: (shells) => set({ shells }),

  newTab: (shell) =>
    set((state) => {
      const session = makeSession(shell);
      const tab: Tab = {
        id: newId(),
        title: shell.label,
        root: makeLeaf(session.id),
        activeSessionId: session.id,
      };
      return {
        sessions: { ...state.sessions, [session.id]: session },
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      };
    }),

  closeTab: (tabId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      const sessions = { ...state.sessions };
      for (const id of allSessionIds(tab.root)) delete sessions[id];
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      const activeTabId =
        state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
      return { sessions, tabs, activeTabId };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  renameTab: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  splitActive: (direction, shell) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      if (!tab) return {};
      const session = makeSession(shell);
      const root: PaneNode = splitNode(
        tab.root,
        tab.activeSessionId,
        direction,
        session.id,
        newId(),
      );
      return {
        sessions: { ...state.sessions, [session.id]: session },
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, root, activeSessionId: session.id } : t,
        ),
      };
    }),

  closePane: (tabId, sessionId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return {};
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      const root = removeNode(tab.root, sessionId);
      if (root === null) {
        // Last pane closed — drop the tab.
        const tabs = state.tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
        return { sessions, tabs, activeTabId };
      }
      const activeSessionId =
        tab.activeSessionId === sessionId ? firstSessionId(root) : tab.activeSessionId;
      return {
        sessions,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, root, activeSessionId } : t)),
      };
    }),

  setActivePane: (tabId, sessionId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activeSessionId: sessionId } : t)),
    })),
}));
