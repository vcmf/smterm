import { describe, it, expect } from "vitest"
import { parseBreadcrumb, collapseBreadcrumb } from "./breadcrumb"

describe("parseBreadcrumb", () => {
  it("splits a POSIX path into cumulative crumbs, root first", () => {
    expect(parseBreadcrumb("/Users/me/repo")).toEqual([
      { name: "/", path: "/" },
      { name: "Users", path: "/Users" },
      { name: "me", path: "/Users/me" },
      { name: "repo", path: "/Users/me/repo" },
    ])
  })
  it("handles the filesystem root", () => {
    expect(parseBreadcrumb("/")).toEqual([{ name: "/", path: "/" }])
  })
  it("ignores a trailing slash", () => {
    expect(parseBreadcrumb("/a/b/").map((c) => c.path)).toEqual(["/", "/a", "/a/b"])
  })
  it("splits a Windows drive path", () => {
    expect(parseBreadcrumb("C:\\Users\\me")).toEqual([
      { name: "C:\\", path: "C:\\" },
      { name: "Users", path: "C:\\Users" },
      { name: "me", path: "C:\\Users\\me" },
    ])
  })
  it("accepts forward slashes on a Windows drive", () => {
    expect(parseBreadcrumb("D:/repo/src").map((c) => c.path)).toEqual([
      "D:\\",
      "D:\\repo",
      "D:\\repo\\src",
    ])
  })
  it("returns [] for a non-absolute path", () => {
    expect(parseBreadcrumb("relative/x")).toEqual([])
    expect(parseBreadcrumb("")).toEqual([])
  })
})

describe("collapseBreadcrumb", () => {
  const crumbs = parseBreadcrumb("/a/b/c/d/e") // 6 crumbs incl. root

  it("shows everything when it fits", () => {
    const { hidden, visible } = collapseBreadcrumb(crumbs, 6)
    expect(hidden).toEqual([])
    expect(visible).toHaveLength(6)
  })
  it("folds leading ancestors, keeps the last maxVisible", () => {
    const { hidden, visible } = collapseBreadcrumb(crumbs, 3)
    expect(hidden.map((c) => c.name)).toEqual(["/", "a", "b"])
    expect(visible.map((c) => c.name)).toEqual(["c", "d", "e"])
  })
  it("always keeps the current dir even at maxVisible < 1", () => {
    const { visible } = collapseBreadcrumb(crumbs, 0)
    expect(visible.map((c) => c.name)).toEqual(["e"])
  })
})
