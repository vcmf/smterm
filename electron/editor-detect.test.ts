import { describe, it, expect } from "vitest"
import { editorDisplayName, MAC_EDITORS } from "./editor-detect"

describe("editorDisplayName", () => {
  it("maps known editors to friendly names", () => {
    expect(editorDisplayName("code")).toBe("VS Code")
    expect(editorDisplayName("cursor")).toBe("Cursor")
    expect(editorDisplayName("subl")).toBe("Sublime Text")
  })
  it("is case- and extension-insensitive (Windows shims)", () => {
    expect(editorDisplayName("Code.cmd")).toBe("VS Code")
    expect(editorDisplayName("CURSOR")).toBe("Cursor")
  })
  it("falls back to the bare command for unknown editors", () => {
    expect(editorDisplayName("myeditor")).toBe("myeditor")
  })
})

describe("MAC_EDITORS", () => {
  it("every entry has a bundle, name and bin", () => {
    for (const e of MAC_EDITORS) {
      expect(e.app).toBeTruthy()
      expect(e.name).toBeTruthy()
      expect(e.bin).toBeTruthy()
    }
  })
})
