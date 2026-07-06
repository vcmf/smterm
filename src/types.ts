export interface ShellOption {
  id: string;
  label: string;
  command: string;
  args: string[];
}

export interface Session {
  id: string;
  title: string;
  command: string;
  args: string[];
}

/** A tab's layout: a binary tree of leaves (terminals) and splits. */
export type PaneNode =
  | { type: "leaf"; sessionId: string }
  | {
      type: "split";
      id: string;
      direction: "row" | "column";
      children: [PaneNode, PaneNode];
    };

export interface Tab {
  id: string;
  title: string;
  root: PaneNode;
  activeSessionId: string;
}
