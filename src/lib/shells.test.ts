import { describe, it, expect } from "vitest"
import { resolveDefaultShell } from "./shells"
import type { ShellOption } from "../types"

const zsh: ShellOption = { id: "z", label: "zsh", command: "/bin/zsh", args: [] }
const bash: ShellOption = { id: "b", label: "bash", command: "/bin/bash", args: [] }

describe("resolveDefaultShell", () => {
  it("returns undefined when there are no shells", () => {
    expect(resolveDefaultShell([], "")).toBeUndefined()
  })
  it("falls back to the first (system) shell when no preference", () => {
    expect(resolveDefaultShell([zsh, bash], "")).toBe(zsh)
  })
  it("matches the preference by command path", () => {
    expect(resolveDefaultShell([zsh, bash], "/bin/bash")).toBe(bash)
  })
  it("matches the preference by id", () => {
    expect(resolveDefaultShell([zsh, bash], "b")).toBe(bash)
  })
  it("falls back to first when the preference is unavailable", () => {
    expect(resolveDefaultShell([zsh, bash], "/usr/bin/fish")).toBe(zsh)
  })
})
