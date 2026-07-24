import { describe, it, expect } from "vitest"
import { wslToUnc } from "./wsl-paths"

describe("wslToUnc", () => {
  it("maps an absolute Linux path into the distro's UNC share", () => {
    expect(wslToUnc("Ubuntu", "/home/me/proj")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\proj")
  })
  it("handles the filesystem root", () => {
    expect(wslToUnc("Ubuntu", "/")).toBe("\\\\wsl.localhost\\Ubuntu\\")
  })
  it("keeps a distro name with spaces/dots", () => {
    expect(wslToUnc("Ubuntu-22.04", "/srv")).toBe("\\\\wsl.localhost\\Ubuntu-22.04\\srv")
  })
  it("returns null without a distro (default distro name unknown → can't form UNC)", () => {
    expect(wslToUnc(undefined, "/home/me")).toBeNull()
  })
  it("returns null for a non-absolute path", () => {
    expect(wslToUnc("Ubuntu", "relative/x")).toBeNull()
    expect(wslToUnc("Ubuntu", "")).toBeNull()
  })
})
