// Detect whether the configured editor can actually open a file, so the file
// context menu can label/enable "Open in <editor>" honestly and left-click can
// fall back to Reveal when nothing is installed. The PATH/fs probes live in
// main.ts (env-dependent); the mapping + strategy logic here is pure and tested.

// EditorInfo is the shared contract (src/lib/file-actions.ts) — main fills it here.
export type { EditorInfo } from "../src/lib/file-actions"

// Friendly display name for an editor command (bare binary or a full path).
// Unknown editors fall back to the basename so the label still says something.
export function editorDisplayName(cmd: string): string {
  const base = cmd
    .replace(/.*[/\\]/, "") // strip any directory (quoted full-path templates)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase()
  const known: Record<string, string> = {
    code: "VS Code",
    "code-insiders": "VS Code Insiders",
    codium: "VSCodium",
    cursor: "Cursor",
    windsurf: "Windsurf",
    subl: "Sublime Text",
    zed: "Zed",
    idea: "IntelliJ IDEA",
    webstorm: "WebStorm",
    nvim: "Neovim",
    vim: "Vim",
    emacs: "Emacs",
    hx: "Helix",
  }
  return known[base] ?? base
}

// First token of an openPath template, respecting a leading quoted path — e.g.
// `"/Applications/My Editor.app/Contents/.../code" -g {file}` → the full quoted
// path (not truncated at the first space), `code -g {file}` → `code`.
export function editorCommandName(template: string): string {
  const m = /^"([^"]*)"|^'([^']*)'|^(\S+)/.exec(template.trim())
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : ""
}

// MAC_EDITORS ordered so the one matching the configured command comes first, so
// `code` resolves to Visual Studio Code rather than whatever editor is listed first.
export function orderMacEditors(cmd: string): MacEditor[] {
  const bin = cmd
    .replace(/.*[/\\]/, "")
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase()
  return [...MAC_EDITORS].sort((a, b) => Number(b.bin === bin) - Number(a.bin === bin))
}

// How openFile should launch, decided purely from the template + injected probes:
//  template  → the command is on PATH (spawn it; supports line/col jump)
//  osDefault → empty template (user opted into the OS default app)
//  macApp    → no CLI, but a known editor .app is installed (`open -a <App>`)
//  none      → nothing available (caller reveals the file instead)
export type EditorPlan =
  | { kind: "template"; name: string }
  | { kind: "osDefault"; name: "" }
  | { kind: "macApp"; name: string; app: string }
  | { kind: "none"; name: "" }

/** Pure editor-open decision. Probes (PATH lookup, mac .app lookup) are injected so
 *  this is unit-testable; main.ts supplies the fs-backed implementations. */
export function planEditor(
  template: string,
  probes: {
    onPath: (cmd: string) => boolean
    macAppFor: (cmd: string) => { name: string; app: string } | null
  },
): EditorPlan {
  const t = template.trim()
  if (!t) return { kind: "osDefault", name: "" }
  const cmd = editorCommandName(t)
  if (cmd && probes.onPath(cmd)) return { kind: "template", name: editorDisplayName(cmd) }
  const app = probes.macAppFor(cmd)
  if (app) return { kind: "macApp", name: app.name, app: app.app }
  return { kind: "none", name: "" }
}

// macOS editors we can launch via `open -a` even without a CLI shim on PATH.
// (Order = detection preference.) `bin` links a bundle back to a friendly name.
export interface MacEditor {
  app: string // .app bundle name under /Applications
  name: string
  bin: string // the CLI that would map to the same editor
}
export const MAC_EDITORS: readonly MacEditor[] = [
  { app: "Visual Studio Code", name: "VS Code", bin: "code" },
  { app: "Cursor", name: "Cursor", bin: "cursor" },
  { app: "VSCodium", name: "VSCodium", bin: "codium" },
  { app: "Windsurf", name: "Windsurf", bin: "windsurf" },
  { app: "Sublime Text", name: "Sublime Text", bin: "subl" },
  { app: "Zed", name: "Zed", bin: "zed" },
]
