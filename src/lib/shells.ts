import type { ShellOption } from "../types"

/** The shell a new tab/split should use: the configured default (matched by
 *  command path or id) if available, else the system default (first listed). */
export function resolveDefaultShell(shells: ShellOption[], pref: string): ShellOption | undefined {
  if (pref) {
    const match = shells.find((s) => s.command === pref || s.id === pref)
    if (match) return match
  }
  return shells[0]
}
