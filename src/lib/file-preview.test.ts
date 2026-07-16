import { describe, it, expect } from "vitest"
import {
  classifyPreview,
  languageForPath,
  escapeHtml,
  formatSize,
  PREVIEW_READ_CAP,
} from "./file-preview"

describe("classifyPreview", () => {
  it("NUL byte → binary", () => {
    expect(classifyPreview(100, 100, true)).toEqual({ kind: "binary", truncated: false })
  })
  it("fully read text is not truncated", () => {
    expect(classifyPreview(100, 100, false)).toEqual({ kind: "text", truncated: false })
  })
  it("read less than the size → truncated", () => {
    expect(classifyPreview(PREVIEW_READ_CAP + 1, PREVIEW_READ_CAP, false)).toEqual({
      kind: "text",
      truncated: true,
    })
  })
})

describe("languageForPath", () => {
  it("maps common extensions to hljs ids", () => {
    expect(languageForPath("/a/b/app.ts")).toBe("typescript")
    expect(languageForPath("comp.tsx")).toBe("typescript")
    expect(languageForPath("main.rs")).toBe("rust")
    expect(languageForPath("style.css")).toBe("css")
    expect(languageForPath("data.yaml")).toBe("yaml")
    expect(languageForPath("index.html")).toBe("xml")
  })
  it("matches known filenames case-insensitively", () => {
    expect(languageForPath("/repo/Dockerfile")).toBe("dockerfile")
    expect(languageForPath("Makefile")).toBe("makefile")
    expect(languageForPath("/home/me/.zshrc")).toBe("bash")
  })
  it("returns null for unknown extensions and extensionless files", () => {
    expect(languageForPath("notes.xyz")).toBeNull()
    expect(languageForPath("LICENSE")).toBeNull()
    expect(languageForPath("/a/.gitignore")).toBeNull() // known-but-plaintext
  })
})

describe("escapeHtml", () => {
  it("escapes the five significant chars", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    )
  })
  it("leaves plain text untouched", () => {
    expect(escapeHtml("const x = 1")).toBe("const x = 1")
  })
})

describe("formatSize", () => {
  it("formats bytes / KB / MB", () => {
    expect(formatSize(512)).toBe("512 B")
    expect(formatSize(4300)).toBe("4.2 KB")
    expect(formatSize(3_250_000)).toBe("3.1 MB")
  })
})
