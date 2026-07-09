import { describe, it, expect } from "vitest"
import { resolveDefaultShell, inheritShell } from "./shells"
import type { ShellOption } from "../types"

const zsh: ShellOption = { id: "z", label: "zsh", command: "/bin/zsh", args: [] }
const bash: ShellOption = { id: "b", label: "bash", command: "/bin/bash", args: [] }
const pwsh: ShellOption = {
  id: "powershell",
  label: "PowerShell",
  command: "powershell.exe",
  args: [],
}
const wsl: ShellOption = {
  id: "wsl:Ubuntu",
  label: "WSL: Ubuntu",
  command: "wsl.exe",
  args: ["-d", "Ubuntu"],
}

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

describe("inheritShell", () => {
  it("inherits the source pane's shell (WSL → WSL, not the list's first)", () => {
    // Windows ordering puts PowerShell first; splitting a WSL pane must stay WSL.
    expect(inheritShell([pwsh, wsl], { command: "wsl.exe", args: ["-d", "Ubuntu"] })).toBe(wsl)
  })

  it("matches on args too (different distro is a different shell)", () => {
    const wslDebian: ShellOption = { ...wsl, id: "wsl:Debian", args: ["-d", "Debian"] }
    expect(
      inheritShell([pwsh, wsl, wslDebian], { command: "wsl.exe", args: ["-d", "Debian"] }),
    ).toBe(wslDebian)
  })

  it("synthesizes an option when the source shell isn't in the list", () => {
    const r = inheritShell([pwsh], { command: "/opt/bin/fish", args: [] })
    expect(r).toMatchObject({ command: "/opt/bin/fish", label: "fish", args: [] })
  })

  it("returns undefined when there is no source pane", () => {
    expect(inheritShell([pwsh, wsl], undefined)).toBeUndefined()
  })
})
