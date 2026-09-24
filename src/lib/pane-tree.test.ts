import { describe, it, expect } from "vitest"
import {
  addSurface,
  allPanes,
  allSessionIds,
  findPane,
  findPaneById,
  firstSessionId,
  makeLeaf,
  removeNode,
  removePane,
  selectSurface,
  splitNode,
  visibleSessionIds,
} from "./pane-tree"
import type { PaneNode } from "../types"

// a | (b / c) — three single-surface panes pa, pb, pc.
const three = (): PaneNode =>
  splitNode(
    splitNode(makeLeaf("pa", "a"), "a", "row", "b", "s1", "pb"),
    "b",
    "column",
    "c",
    "s2",
    "pc",
  )

describe("paneTree", () => {
  it("makeLeaf builds a single-surface pane", () => {
    expect(makeLeaf("p", "a")).toEqual({
      type: "leaf",
      id: "p",
      sessionIds: ["a"],
      activeSessionId: "a",
    })
  })

  describe("splitNode", () => {
    it("splits the target pane into a two-child split", () => {
      const result = splitNode(makeLeaf("pa", "a"), "a", "row", "b", "split-1", "pb")
      expect(result).toEqual({
        type: "split",
        id: "split-1",
        direction: "row",
        children: [makeLeaf("pa", "a"), makeLeaf("pb", "b")],
      })
    })

    it("splits a nested pane, leaving siblings untouched", () => {
      const tree = three()
      expect(allSessionIds(tree)).toEqual(["a", "b", "c"])
      expect(tree.type === "split" && tree.children[0]).toEqual(makeLeaf("pa", "a"))
    })

    it("targets a pane by any of its surfaces and keeps its surfaces together", () => {
      const root = addSurface(makeLeaf("pa", "a"), "pa", "a2")
      const result = splitNode(root, "a2", "row", "b", "s1", "pb")
      expect(allPanes(result).map((p) => p.sessionIds)).toEqual([["a", "a2"], ["b"]])
    })

    it("is a no-op (same reference) when the target is absent", () => {
      const root = makeLeaf("pa", "a")
      expect(splitNode(root, "zzz", "row", "b", "s1", "pb")).toBe(root)
    })
  })

  describe("addSurface / selectSurface", () => {
    it("appends a surface and makes it active", () => {
      const root = addSurface(makeLeaf("pa", "a"), "pa", "a2")
      expect(root).toMatchObject({ sessionIds: ["a", "a2"], activeSessionId: "a2" })
    })

    it("only touches the named pane", () => {
      const tree = addSurface(three(), "pc", "c2")
      expect(allPanes(tree).map((p) => p.sessionIds)).toEqual([["a"], ["b"], ["c", "c2"]])
    })

    it("ignores a duplicate or unknown pane (same reference)", () => {
      const tree = three()
      expect(addSurface(tree, "nope", "x")).toBe(tree)
      expect(addSurface(tree, "pa", "a")).toBe(tree)
    })

    it("selectSurface switches the visible surface of the pane holding it", () => {
      const root = addSurface(makeLeaf("pa", "a"), "pa", "a2")
      expect(selectSurface(root, "a")).toMatchObject({ activeSessionId: "a" })
    })

    it("selectSurface is a no-op (same reference) when already active or absent", () => {
      const tree = three()
      expect(selectSurface(tree, "a")).toBe(tree)
      expect(selectSurface(tree, "zzz")).toBe(tree)
    })
  })

  describe("removeNode", () => {
    it("returns null when the only surface of the only pane is removed", () => {
      expect(removeNode(makeLeaf("pa", "a"), "a")).toBeNull()
    })

    it("collapses a split when a single-surface pane is removed", () => {
      const root = splitNode(makeLeaf("pa", "a"), "a", "row", "b", "s1", "pb")
      expect(removeNode(root, "b")).toEqual(makeLeaf("pa", "a"))
      expect(removeNode(root, "a")).toEqual(makeLeaf("pb", "b"))
    })

    it("keeps the split when both children survive", () => {
      const afterRemove = removeNode(three(), "a")
      expect(afterRemove && allSessionIds(afterRemove)).toEqual(["b", "c"])
    })

    it("removing one of several surfaces keeps the pane", () => {
      const root = addSurface(addSurface(makeLeaf("pa", "a"), "pa", "b"), "pa", "c")
      expect(removeNode(root, "a")).toMatchObject({ id: "pa", sessionIds: ["b", "c"] })
    })

    it("hands visibility to the right neighbour, else the left", () => {
      // a, b, c with b active
      const root = selectSurface(
        addSurface(addSurface(makeLeaf("pa", "a"), "pa", "b"), "pa", "c"),
        "b",
      )
      expect(removeNode(root, "b")).toMatchObject({ activeSessionId: "c" })
      const lastActive = selectSurface(root, "c")
      expect(removeNode(lastActive, "c")).toMatchObject({ activeSessionId: "b" })
    })

    it("keeps the active surface when a hidden one is removed", () => {
      const root = addSurface(makeLeaf("pa", "a"), "pa", "b") // b active
      expect(removeNode(root, "a")).toMatchObject({ activeSessionId: "b" })
    })

    it("leaves the tree unchanged (same reference) when the target is absent", () => {
      const tree = three()
      expect(removeNode(tree, "zzz")).toBe(tree)
    })
  })

  describe("removePane", () => {
    it("drops a pane with all its surfaces and collapses the split", () => {
      const root = splitNode(
        addSurface(makeLeaf("pa", "a"), "pa", "a2"),
        "a",
        "row",
        "b",
        "s1",
        "pb",
      )
      expect(removePane(root, "pa")).toEqual(makeLeaf("pb", "b"))
    })

    it("returns null when the last pane is removed", () => {
      expect(removePane(makeLeaf("pa", "a"), "pa")).toBeNull()
    })
  })

  describe("queries", () => {
    const tree = addSurface(three(), "pb", "b2") // pb: [b, b2], b2 visible

    it("allSessionIds lists every surface left-to-right, hidden ones included", () => {
      expect(allSessionIds(tree)).toEqual(["a", "b", "b2", "c"])
    })

    it("visibleSessionIds lists only each pane's active surface", () => {
      expect(visibleSessionIds(tree)).toEqual(["a", "b2", "c"])
    })

    it("findPaneById locates a pane by its id", () => {
      expect(findPaneById(tree, "pb")?.sessionIds).toEqual(["b", "b2"])
      expect(findPaneById(tree, "zzz")).toBeUndefined()
    })

    it("findPane locates the pane holding a surface", () => {
      expect(findPane(tree, "b")?.id).toBe("pb")
      expect(findPane(tree, "zzz")).toBeUndefined()
    })

    it("firstSessionId returns the leftmost pane's visible surface", () => {
      expect(firstSessionId(tree)).toBe("a")
      const hiddenFirst = addSurface(makeLeaf("p", "solo"), "p", "solo2")
      expect(firstSessionId(hiddenFirst)).toBe("solo2")
    })
  })
})
