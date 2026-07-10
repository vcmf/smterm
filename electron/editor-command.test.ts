import { describe, it, expect } from "vitest"
import { buildEditorCommand } from "./editor-command"

describe("buildEditorCommand", () => {
  it("builds the default VS Code -g invocation with line:col", () => {
    expect(
      buildEditorCommand("code -g {file}:{line}:{col}", {
        file: "/repo/src/app.ts",
        line: 42,
        col: 10,
      }),
    ).toEqual({ cmd: "code", args: ["-g", "/repo/src/app.ts:42:10"] })
  })

  it("defaults missing line/col to 1", () => {
    expect(buildEditorCommand("code -g {file}:{line}:{col}", { file: "/a/b.ts" })).toEqual({
      cmd: "code",
      args: ["-g", "/a/b.ts:1:1"],
    })
  })

  it("supports other editors' flag shapes", () => {
    expect(buildEditorCommand("idea --line {line} {file}", { file: "/a/b.ts", line: 7 })).toEqual({
      cmd: "idea",
      args: ["--line", "7", "/a/b.ts"],
    })
  })

  it("keeps a file path with spaces as one argv entry", () => {
    expect(buildEditorCommand("code {file}", { file: "/my repo/x.ts" })).toEqual({
      cmd: "code",
      args: ["/my repo/x.ts"],
    })
  })

  it("returns null for an empty template (→ OS default)", () => {
    expect(buildEditorCommand("", { file: "/a/b.ts" })).toBeNull()
    expect(buildEditorCommand("   ", { file: "/a/b.ts" })).toBeNull()
  })
})
