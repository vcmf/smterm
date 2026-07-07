import { describe, it, expect } from "vitest"
import { parseWslDistros, buildInjection } from "./shell-integration"

describe("parseWslDistros", () => {
  it("splits distro names and trims blank lines", () => {
    expect(parseWslDistros("Ubuntu\r\nDebian\r\n")).toEqual(["Ubuntu", "Debian"])
    expect(parseWslDistros("\r\n   \r\n")).toEqual([])
  })

  it("strips NUL bytes (UTF-16 decode artifacts)", () => {
    expect(parseWslDistros("U\0b\0untu\n")).toEqual(["Ubuntu"])
  })
})

describe("buildInjection", () => {
  it("zsh → ZDOTDIR wrapper, no extra args", () => {
    const inj = buildInjection("/bin/zsh")
    expect(inj?.args).toEqual([])
    expect(inj?.env.SMTERM_SHELL_INTEGRATION).toBe("1")
    expect(inj?.env.ZDOTDIR).toContain("zsh")
  })

  it("bash → --rcfile", () => {
    const inj = buildInjection("/bin/bash")
    expect(inj?.args[0]).toBe("--rcfile")
    expect(inj?.env.SMTERM_SHELL_INTEGRATION).toBe("1")
  })

  it("unsupported shells → null", () => {
    expect(buildInjection("/usr/bin/fish")).toBeNull()
    expect(buildInjection("powershell.exe")).toBeNull()
  })
})
