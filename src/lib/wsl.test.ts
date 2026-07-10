import { describe, it, expect } from "vitest"
import { wslContext } from "./wsl"

describe("wslContext", () => {
  it("returns undefined for native shells", () => {
    expect(wslContext("/bin/zsh", [])).toBeUndefined()
    expect(wslContext("powershell.exe", [])).toBeUndefined()
    expect(wslContext("cmd.exe", [])).toBeUndefined()
  })

  it("detects wsl.exe with an explicit distro (-d / --distribution)", () => {
    expect(wslContext("wsl.exe", ["-d", "Ubuntu"])).toEqual({ distro: "Ubuntu" })
    expect(wslContext("C:\\Windows\\System32\\wsl.exe", ["--distribution", "Debian"])).toEqual({
      distro: "Debian",
    })
  })

  it("defaults distro to undefined when none is given", () => {
    expect(wslContext("wsl.exe", [])).toEqual({ distro: undefined })
    expect(wslContext("WSL.EXE", ["--cd", "~"])).toEqual({ distro: undefined })
  })
})
