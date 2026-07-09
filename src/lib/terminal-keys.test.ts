import { describe, it, expect } from "vitest"
import { keyAction, type TermKeyEvent } from "./terminal-keys"

const ev = (over: Partial<TermKeyEvent>): TermKeyEvent => ({
  key: "a",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})

describe("keyAction — macOS", () => {
  const mac = (e: TermKeyEvent, hasSelection = false) => keyAction(e, { isMac: true, hasSelection })

  it("⌘C copies only when there is a selection", () => {
    expect(mac(ev({ key: "c", metaKey: true }), true)).toBe("copy")
    expect(mac(ev({ key: "c", metaKey: true }), false)).toBeNull()
  })

  it("⌘V pastes; ⌘A selects all", () => {
    expect(mac(ev({ key: "v", metaKey: true }))).toBe("paste")
    expect(mac(ev({ key: "a", metaKey: true }))).toBe("select-all")
  })

  it("⌃C (no ⌘) is left alone — SIGINT stays with the shell", () => {
    expect(mac(ev({ key: "c", ctrlKey: true }), true)).toBeNull()
  })

  it("ignores ⌘-combos with extra modifiers", () => {
    expect(mac(ev({ key: "v", metaKey: true, altKey: true }))).toBeNull()
    expect(mac(ev({ key: "c", metaKey: true, ctrlKey: true }), true)).toBeNull()
  })
})

describe("keyAction — Linux/Windows", () => {
  const pc = (e: TermKeyEvent, hasSelection = false) => keyAction(e, { isMac: false, hasSelection })

  it("Ctrl+Shift+C/V/A map to copy/paste/select-all", () => {
    expect(pc(ev({ key: "c", ctrlKey: true, shiftKey: true }), true)).toBe("copy")
    expect(pc(ev({ key: "v", ctrlKey: true, shiftKey: true }))).toBe("paste")
    expect(pc(ev({ key: "a", ctrlKey: true, shiftKey: true }))).toBe("select-all")
  })

  it("plain Ctrl+C / Ctrl+V are left alone (SIGINT / literal)", () => {
    expect(pc(ev({ key: "c", ctrlKey: true }), true)).toBeNull()
    expect(pc(ev({ key: "v", ctrlKey: true }))).toBeNull()
  })

  it("Ctrl+Shift+C without a selection does nothing", () => {
    expect(pc(ev({ key: "c", ctrlKey: true, shiftKey: true }), false)).toBeNull()
  })

  it("⌘ combos don't trigger on non-mac", () => {
    expect(pc(ev({ key: "v", metaKey: true }))).toBeNull()
  })
})
