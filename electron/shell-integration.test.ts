import { describe, it, expect } from "vitest"
import {
  parseWslDistros,
  buildInjection,
  isWslShell,
  wslCdArgs,
  parseLoginShell,
  wslInjection,
  ZSH_ZSHRC,
  BASH_RC,
} from "./shell-integration"

describe("parseWslDistros", () => {
  it("splits distro names and trims blank lines", () => {
    expect(parseWslDistros("Ubuntu\r\nDebian\r\n")).toEqual(["Ubuntu", "Debian"])
    expect(parseWslDistros("\r\n   \r\n")).toEqual([])
  })

  it("strips NUL bytes (UTF-16 decode artifacts)", () => {
    expect(parseWslDistros("U\0b\0untu\n")).toEqual(["Ubuntu"])
  })
})

describe("isWslShell", () => {
  it("matches wsl.exe (any path, case-insensitive)", () => {
    expect(isWslShell("wsl.exe")).toBe(true)
    expect(isWslShell("C:\\Windows\\System32\\wsl.exe")).toBe(true)
    expect(isWslShell("WSL.EXE")).toBe(true)
  })
  it("does not match other shells", () => {
    expect(isWslShell("powershell.exe")).toBe(false)
    expect(isWslShell("/bin/zsh")).toBe(false)
    expect(isWslShell("mywsl.exe.sh")).toBe(false)
  })
})

describe("wslCdArgs", () => {
  it("starts in the Linux home when there's no tracked path", () => {
    expect(wslCdArgs(undefined)).toEqual(["--cd", "~"])
  })
  it("ignores a Windows cwd (would translate to /mnt/c/...) and uses ~", () => {
    expect(wslCdArgs("C:\\Users\\me\\proj")).toEqual(["--cd", "~"])
  })
  it("passes through a tracked Linux path", () => {
    expect(wslCdArgs("/home/me/proj")).toEqual(["--cd", "/home/me/proj"])
  })
})

describe("parseLoginShell", () => {
  it("takes the last field of a getent passwd line", () => {
    expect(parseLoginShell("me:x:1000:1000:Me:/home/me:/usr/bin/zsh")).toBe("/usr/bin/zsh")
    expect(parseLoginShell("root:x:0:0:root:/root:/bin/bash\n")).toBe("/bin/bash")
  })
  it("returns empty for a malformed line", () => {
    expect(parseLoginShell("garbage")).toBe("")
  })
})

describe("wslInjection", () => {
  const base = "/mnt/c/Users/me/AppData/Local/Temp/smterm/shell-integration"

  it("bash → --rcfile with the WSL-translated path", () => {
    const r = wslInjection("/bin/bash", base)
    expect(r?.args).toEqual(["--", "bash", "--rcfile", `${base}/bash/bashrc`, "-i"])
    expect(r?.wslenv).toEqual([])
  })

  it("zsh → ZDOTDIR forwarded across the WSL boundary", () => {
    const r = wslInjection("/usr/bin/zsh", base)
    expect(r?.args).toEqual(["--", "zsh", "-i"])
    expect(r?.env.ZDOTDIR).toBe(`${base}/zsh`)
    expect(r?.wslenv).toContain("ZDOTDIR")
  })

  it("unsupported shells (fish) → null (plain shell, no integration)", () => {
    expect(wslInjection("/usr/bin/fish", base)).toBeNull()
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
