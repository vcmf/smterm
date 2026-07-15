// Which clipboard action a key event maps to, given platform + whether the
// terminal currently has a selection. Pure so the (fiddly, platform-dependent)
// rules are unit-tested; terminal-manager supplies isMac + hasSelection and runs it.
//
// macOS: ⌘C / ⌘V / ⌘A (⌘C only with a selection; ⌃C stays SIGINT).
// Linux/Windows (Windows-terminal convention): plain ⌃C **copies when there's a
// selection, else sends SIGINT**; ⌃⇧C / ⌃⇧V / ⌃⇧A are the explicit forms. (The caller
// clears the selection after a ⌃C copy so a second ⌃C interrupts.)

export type TermKeyAction = "copy" | "paste" | "select-all" | "newline" | null

/** How a paste should be delivered, given clipboard state. Text wins (normal paste,
 *  works everywhere); an image with no text routes to the running program (send raw
 *  Ctrl+V so it reads the image itself); nothing to do otherwise. Pure — tested. */
export function pasteAction(text: string, hasImage: boolean): "text" | "image" | "none" {
  if (text) return "text"
  if (hasImage) return "image"
  return "none"
}

export interface TermKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function keyAction(
  e: TermKeyEvent,
  opts: { isMac: boolean; hasSelection: boolean },
): TermKeyAction {
  const key = e.key.toLowerCase()
  // Shift+Enter → insert a newline (multi-line input for agents like Claude Code)
  // instead of submitting. The caller sends the CSI-u encoding. Platform-independent.
  if (key === "enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return "newline"
  if (e.altKey) return null

  if (opts.isMac) {
    // ⌘ + key, no other modifiers.
    if (!e.metaKey || e.ctrlKey) return null
    if (key === "c") return opts.hasSelection ? "copy" : null
    if (key === "v") return "paste"
    if (key === "a") return "select-all"
    return null
  }

  // Linux/Windows.
  if (e.metaKey) return null
  // Plain Ctrl+C copies only when there's a selection (else it passes through as
  // SIGINT); other plain-Ctrl keys (Ctrl+V literal, etc.) pass through untouched.
  if (e.ctrlKey && !e.shiftKey) {
    return key === "c" && opts.hasSelection ? "copy" : null
  }
  // Ctrl+Shift+{C,V,A} — explicit copy / paste / select-all.
  if (e.ctrlKey && e.shiftKey) {
    if (key === "c") return opts.hasSelection ? "copy" : null
    if (key === "v") return "paste"
    if (key === "a") return "select-all"
  }
  return null
}
