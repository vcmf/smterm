import { describe, it, expect } from "vitest"
import {
  editorDisplayName,
  editorCommandName,
  orderMacEditors,
  planEditor,
  MAC_EDITORS,
} from "./editor-detect"

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
  it("basenames a full path", () => {
    expect(editorDisplayName("/Applications/My Editor.app/Contents/Resources/app/bin/code")).toBe(
      "VS Code",
    )
    expect(editorDisplayName("C:\\tools\\myeditor.exe")).toBe("myeditor")
  })
  it("falls back to the basename for unknown editors", () => {
    expect(editorDisplayName("myeditor")).toBe("myeditor")
  })
})

describe("editorCommandName", () => {
  it("returns the first bare token", () => {
    expect(editorCommandName("code -g {file}:{line}:{col}")).toBe("code")
  })
  it("keeps a double-quoted path with spaces whole", () => {
    expect(editorCommandName('"/Applications/My Editor.app/bin/code" -g {file}')).toBe(
      "/Applications/My Editor.app/bin/code",
    )
  })
  it("keeps a single-quoted path whole", () => {
    expect(editorCommandName("'/opt/my editor/bin' --line {line}")).toBe("/opt/my editor/bin")
  })
  it("empty template → empty", () => {
    expect(editorCommandName("   ")).toBe("")
  })
})

describe("orderMacEditors", () => {
  it("puts the matching editor first (basename + ext insensitive)", () => {
    expect(orderMacEditors("cursor")[0]!.bin).toBe("cursor")
    expect(orderMacEditors("/usr/local/bin/code")[0]!.bin).toBe("code")
    expect(orderMacEditors("Code.cmd")[0]!.bin).toBe("code")
  })
  it("keeps the full set and is stable for a non-match", () => {
    const out = orderMacEditors("nvim")
    expect(out).toHaveLength(MAC_EDITORS.length)
    expect(out[0]!.bin).toBe(MAC_EDITORS[0]!.bin) // no match → original order
  })
})

describe("planEditor", () => {
  const none = { onPath: () => false, macAppFor: () => null }

  it("empty template → osDefault", () => {
    expect(planEditor("", none).kind).toBe("osDefault")
    expect(planEditor("   ", none).kind).toBe("osDefault")
  })
  it("command on PATH → template, named", () => {
    const plan = planEditor("code -g {file}", { ...none, onPath: (c) => c === "code" })
    expect(plan).toEqual({ kind: "template", name: "VS Code" })
  })
  it("quoted full path on PATH → template (first-token respected)", () => {
    const p = '"/Applications/My Editor.app/bin/code" -g {file}'
    const plan = planEditor(p, {
      onPath: (c) => c === "/Applications/My Editor.app/bin/code",
      macAppFor: () => null,
    })
    expect(plan).toEqual({ kind: "template", name: "VS Code" })
  })
  it("not on PATH but a mac app is installed → macApp", () => {
    const plan = planEditor("code -g {file}", {
      onPath: () => false,
      macAppFor: () => ({ name: "VS Code", app: "Visual Studio Code" }),
    })
    expect(plan).toEqual({ kind: "macApp", name: "VS Code", app: "Visual Studio Code" })
  })
  it("nothing available → none", () => {
    expect(planEditor("code -g {file}", none).kind).toBe("none")
  })
  it("PATH takes precedence over a mac app", () => {
    const plan = planEditor("code -g {file}", {
      onPath: () => true,
      macAppFor: () => ({ name: "Cursor", app: "Cursor" }),
    })
    expect(plan.kind).toBe("template")
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
