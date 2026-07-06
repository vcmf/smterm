import { describe, it, expect } from "vitest";
import { allSessionIds, firstSessionId, makeLeaf, removeNode, splitNode } from "./paneTree";
import type { PaneNode } from "../types";

describe("paneTree", () => {
  it("makeLeaf builds a leaf", () => {
    expect(makeLeaf("a")).toEqual({ type: "leaf", sessionId: "a" });
  });

  describe("splitNode", () => {
    it("splits the target leaf into a two-child split", () => {
      const root = makeLeaf("a");
      const result = splitNode(root, "a", "row", "b", "split-1");
      expect(result).toEqual({
        type: "split",
        id: "split-1",
        direction: "row",
        children: [
          { type: "leaf", sessionId: "a" },
          { type: "leaf", sessionId: "b" },
        ],
      });
    });

    it("splits a nested leaf, leaving siblings untouched", () => {
      const root = splitNode(makeLeaf("a"), "a", "row", "b", "s1");
      const result = splitNode(root, "b", "column", "c", "s2");
      expect(allSessionIds(result)).toEqual(["a", "b", "c"]);
      // 'b' is now a column split; 'a' remains a plain leaf.
      expect(result.type).toBe("split");
    });

    it("is a no-op when the target is absent", () => {
      const root = makeLeaf("a");
      expect(splitNode(root, "zzz", "row", "b", "s1")).toBe(root);
    });
  });

  describe("removeNode", () => {
    it("returns null when the only leaf is removed", () => {
      expect(removeNode(makeLeaf("a"), "a")).toBeNull();
    });

    it("collapses a split when one child is removed", () => {
      const root = splitNode(makeLeaf("a"), "a", "row", "b", "s1");
      expect(removeNode(root, "b")).toEqual({ type: "leaf", sessionId: "a" });
      expect(removeNode(root, "a")).toEqual({ type: "leaf", sessionId: "b" });
    });

    it("keeps the split when both children survive", () => {
      const root: PaneNode = splitNode(makeLeaf("a"), "a", "row", "b", "s1");
      const withThree = splitNode(root, "b", "column", "c", "s2");
      const afterRemove = removeNode(withThree, "a");
      expect(afterRemove && allSessionIds(afterRemove)).toEqual(["b", "c"]);
    });

    it("leaves the tree unchanged when the target is absent", () => {
      const root = splitNode(makeLeaf("a"), "a", "row", "b", "s1");
      expect(allSessionIds(removeNode(root, "zzz")!)).toEqual(["a", "b"]);
    });
  });

  describe("queries", () => {
    const tree = splitNode(
      splitNode(makeLeaf("a"), "a", "row", "b", "s1"),
      "b",
      "column",
      "c",
      "s2",
    );

    it("allSessionIds lists every leaf left-to-right", () => {
      expect(allSessionIds(tree)).toEqual(["a", "b", "c"]);
    });

    it("firstSessionId returns the leftmost leaf", () => {
      expect(firstSessionId(tree)).toBe("a");
      expect(firstSessionId(makeLeaf("solo"))).toBe("solo");
    });
  });
});
