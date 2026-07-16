import { describe, it, expect } from "vitest"
import { fileMenuItems, clampMenuPosition, revealLabel } from "./file-actions"

const base = { editorName: "VS Code", editorAvailable: true, revealLabel: "Reveal in Finder" }

describe("fileMenuItems", () => {
  it("file: Open (named) + Reveal + Copy path + Copy relative", () => {
    const items = fileMenuItems({ ...base, isDir: false })
    expect(items.map((i) => i.id)).toEqual(["open", "reveal", "copyPath", "copyRel"])
    expect(items[0]!.label).toBe("Open in VS Code")
    expect(items[0]!.disabled).toBeFalsy()
    expect(items.find((i) => i.id === "copyPath")!.separatorBefore).toBe(true)
  })

  it("folder: no Open item", () => {
    const items = fileMenuItems({ ...base, isDir: true })
    expect(items.map((i) => i.id)).toEqual(["reveal", "copyPath", "copyRel"])
  })

  it("no editor: Open is disabled with a generic label + hint", () => {
    const items = fileMenuItems({
      isDir: false,
      editorName: "",
      editorAvailable: false,
      revealLabel: "Reveal in Explorer",
    })
    const open = items.find((i) => i.id === "open")!
    expect(open.label).toBe("Open in editor")
    expect(open.disabled).toBe(true)
    expect(open.hint).toBe("not found")
  })

  it("uses the OS-specific reveal label", () => {
    expect(
      fileMenuItems({ ...base, isDir: true, revealLabel: "Show in File Manager" })[0]!.label,
    ).toBe("Show in File Manager")
  })
})

describe("revealLabel", () => {
  it("names the OS file manager", () => {
    expect(revealLabel("darwin")).toBe("Reveal in Finder")
    expect(revealLabel("win32")).toBe("Reveal in Explorer")
    expect(revealLabel("linux")).toBe("Show in File Manager")
  })
})

describe("clampMenuPosition", () => {
  it("passes through when it fits", () => {
    expect(clampMenuPosition(100, 100, 200, 150, 1000, 800)).toEqual({ x: 100, y: 100 })
  })
  it("nudges left/up when it would overflow bottom-right", () => {
    expect(clampMenuPosition(950, 780, 200, 150, 1000, 800)).toEqual({ x: 794, y: 644 })
  })
  it("clamps to the pad when near the top-left edge", () => {
    expect(clampMenuPosition(0, 0, 200, 150, 1000, 800)).toEqual({ x: 6, y: 6 })
  })
})
