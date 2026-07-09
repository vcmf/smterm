// Which clipboard action a key event maps to, given platform + whether the
// terminal currently has a selection. Pure so the (fiddly, platform-dependent)
// rules are unit-tested; terminal-manager supplies isMac + hasSelection and runs it.
//
// macOS: ⌘C / ⌘V / ⌘A (⌘C only with a selection; ⌃C stays SIGINT).
// Linux/Windows: ⌃⇧C / ⌃⇧V / ⌃⇧A — plain ⌃C/⌃V stay SIGINT / literal so the shell keeps them.

export type TermKeyAction = "copy" | "paste" | "select-all" | null

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
  if (e.altKey) return null

  if (opts.isMac) {
    // ⌘ + key, no other modifiers.
    if (!e.metaKey || e.ctrlKey) return null
    if (key === "c") return opts.hasSelection ? "copy" : null
    if (key === "v") return "paste"
    if (key === "a") return "select-all"
    return null
  }

  // Linux/Windows: require Ctrl+Shift (never plain Ctrl — that's SIGINT etc.).
  if (!e.ctrlKey || !e.shiftKey || e.metaKey) return null
  if (key === "c") return opts.hasSelection ? "copy" : null
  if (key === "v") return "paste"
  if (key === "a") return "select-all"
  return null
}
