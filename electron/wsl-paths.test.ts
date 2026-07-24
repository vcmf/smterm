import { describe, it, expect } from "vitest"
import { wslUncCandidates, winToMnt } from "./wsl-paths"

describe("wslUncCandidates", () => {
  it("maps an absolute Linux path into both share forms, newest first", () => {
    expect(wslUncCandidates("Ubuntu", "/home/me/proj")).toEqual([
      "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj",
      "\\\\wsl$\\Ubuntu\\home\\me\\proj",
    ])
  })
  it("handles the filesystem root", () => {
    expect(wslUncCandidates("Ubuntu", "/")[0]).toBe("\\\\wsl.localhost\\Ubuntu\\")
  })
  it("keeps a distro name with dots/dashes", () => {
    expect(wslUncCandidates("Ubuntu-22.04", "/srv")[0]).toBe("\\\\wsl.localhost\\Ubuntu-22.04\\srv")
  })
  it("returns [] without a distro (can't form a UNC)", () => {
    expect(wslUncCandidates(undefined, "/home/me")).toEqual([])
  })
  it("returns [] for a non-absolute path", () => {
    expect(wslUncCandidates("Ubuntu", "relative/x")).toEqual([])
    expect(wslUncCandidates("Ubuntu", "")).toEqual([])
  })
})

describe("winToMnt", () => {
  it("maps a Windows drive path to /mnt/<drive>/…", () => {
    expect(winToMnt("C:\\Users\\me\\AppData\\Roaming\\smterm")).toBe(
      "/mnt/c/Users/me/AppData/Roaming/smterm",
    )
    expect(winToMnt("D:/data/x")).toBe("/mnt/d/data/x")
  })
  it("lowercases the drive letter", () => {
    expect(winToMnt("C:\\x")).toBe("/mnt/c/x")
  })
  it("returns null for a non-drive path", () => {
    expect(winToMnt("/already/posix")).toBeNull()
    expect(winToMnt("\\\\wsl.localhost\\Ubuntu\\home")).toBeNull()
  })
})
