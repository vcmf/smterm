import { Group, Panel, Separator } from "react-resizable-panels";
import type { PaneNode } from "../types";
import { nodeKey } from "../lib/paneTree";
import { TerminalPane } from "./TerminalPane";

/** Recursively render a pane tree into resizable split panels. */
export function PaneLayout({ node, tabId }: { node: PaneNode; tabId: string }) {
  if (node.type === "leaf") {
    return <TerminalPane sessionId={node.sessionId} tabId={tabId} />;
  }

  const [first, second] = node.children;
  return (
    <Group orientation={node.direction === "row" ? "horizontal" : "vertical"} id={node.id}>
      <Panel id={nodeKey(first)} minSize="10%">
        <PaneLayout node={first} tabId={tabId} />
      </Panel>
      <Separator className={`resize-handle ${node.direction}`} />
      <Panel id={nodeKey(second)} minSize="10%">
        <PaneLayout node={second} tabId={tabId} />
      </Panel>
    </Group>
  );
}
