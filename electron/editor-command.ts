// Build an editor invocation from a user-configurable template, e.g.
//   "code -g {file}:{line}:{col}"  (VS Code, jump to line) — the default
//   "cursor -g {file}:{line}:{col}" / "idea --line {line} {file}" — overrides
// An empty template means "no editor" → the caller falls back to the OS default.
// Pure — unit-tested; the actual spawn + PATH lookup + fallback live in main.

export interface EditorCommand {
  cmd: string
  args: string[]
}

/** Substitute {file}/{line}/{col} into `template` and split into argv.
 *  Returns null for an empty template (→ open with the OS default app). */
export function buildEditorCommand(
  template: string,
  v: { file: string; line?: number; col?: number },
): EditorCommand | null {
  const t = template.trim()
  if (!t) return null
  const line = String(v.line ?? 1)
  const col = String(v.col ?? 1)
  // Split on whitespace first, then substitute — so a {file} with spaces stays a
  // single argv entry (templates are simple; no shell quoting to parse).
  const parts = t.split(/\s+/).map((p) =>
    p
      .replace(/\{file\}/g, v.file)
      .replace(/\{line\}/g, line)
      .replace(/\{col\}/g, col),
  )
  const [cmd, ...args] = parts
  if (!cmd) return null
  return { cmd, args }
}

/** Quote an argument for the Windows `cmd.exe` shell — needed because editors are
 *  `.cmd` shims there and `spawn` can't exec them without `shell: true`. Windows
 *  paths can't contain `"`, and `& | < > ( ) ^` are literal inside double quotes,
 *  so wrapping is safe (only stray `%VAR%` could expand — harmless). Pure — tested. */
export function winQuote(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}
