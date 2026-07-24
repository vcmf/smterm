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

  it("plain Ctrl+C copies WITH a selection, but is SIGINT without one", () => {
    expect(pc(ev({ key: "c", ctrlKey: true }), true)).toBe("copy") // selection → copy
    expect(pc(ev({ key: "c", ctrlKey: true }), false)).toBeNull() // no selection → SIGINT
  })

  it("plain Ctrl+V stays literal (quoted-insert) on Linux, not paste", () => {
    expect(pc(ev({ key: "v", ctrlKey: true }))).toBeNull()
  })

  it("Ctrl+Shift+C without a selection does nothing", () => {
    expect(pc(ev({ key: "c", ctrlKey: true, shiftKey: true }), false)).toBeNull()
  })

  it("⌘ combos don't trigger on non-mac", () => {
    expect(pc(ev({ key: "v", metaKey: true }))).toBeNull()
  })
})

describe("keyAction — Windows (plain Ctrl+V pastes)", () => {
  const win = (e: TermKeyEvent, hasSelection = false) =>
    keyAction(e, { isMac: false, isWindows: true, hasSelection })

  it("plain Ctrl+V pastes (Windows Terminal convention)", () => {
    expect(win(ev({ key: "v", ctrlKey: true }))).toBe("paste")
  })
  it("Ctrl+Shift+V still pastes; Ctrl+C still copies-on-selection / else SIGINT", () => {
    expect(win(ev({ key: "v", ctrlKey: true, shiftKey: true }))).toBe("paste")
    expect(win(ev({ key: "c", ctrlKey: true }), true)).toBe("copy")
    expect(win(ev({ key: "c", ctrlKey: true }), false)).toBeNull()
  })
})

describe("keyAction — Shift+Enter newline", () => {
  const run = (e: TermKeyEvent, isMac = true) => keyAction(e, { isMac, hasSelection: false })

  it("maps Shift+Enter to a newline (both platforms)", () => {
    expect(run(ev({ key: "Enter", shiftKey: true }), true)).toBe("newline")
    expect(run(ev({ key: "Enter", shiftKey: true }), false)).toBe("newline")
  })

  it("plain Enter and modified Enter are left alone (normal submit)", () => {
    expect(run(ev({ key: "Enter" }))).toBeNull()
    expect(run(ev({ key: "Enter", shiftKey: true, ctrlKey: true }))).toBeNull()
    expect(run(ev({ key: "Enter", shiftKey: true, metaKey: true }))).toBeNull()
    expect(run(ev({ key: "Enter", shiftKey: true, altKey: true }))).toBeNull()
  })
})
