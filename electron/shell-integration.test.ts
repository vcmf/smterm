import { describe, it, expect } from "vitest"
import { parseWslDistros, buildInjection, ZSH_ZSHRC, BASH_RC } from "./shell-integration"

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

describe("precmd mouse-mode reset", () => {
  // Disables for X10/normal (1000), button-event (1002), any-event (1003) tracking
  // + SGR encoding (1006): the sequence that heals a crashed TUI's leftover mouse mode.
  const disables = ["1000l", "1002l", "1003l", "1006l"]

  it("zsh precmd emits every mouse-tracking disable", () => {
    for (const d of disables) expect(ZSH_ZSHRC).toContain(`\\033[?${d}`)
    // Must come after `local ret=$?` so the extra printf can't clobber the exit code.
    expect(ZSH_ZSHRC.indexOf("local ret=$?")).toBeLessThan(ZSH_ZSHRC.indexOf("\\033[?1003l"))
  })

  it("bash precmd emits every mouse-tracking disable", () => {
    for (const d of disables) expect(BASH_RC).toContain(`\\033[?${d}`)
    expect(BASH_RC.indexOf("local ret=$?")).toBeLessThan(BASH_RC.indexOf("\\033[?1003l"))
  })
})
