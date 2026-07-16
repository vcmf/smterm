// Detect whether the configured editor can actually open a file, so the file
// context menu can label/enable "Open in <editor>" honestly and left-click can
// fall back to Reveal when nothing is installed. The PATH/fs probes live in
// main.ts (env-dependent); the mapping + strategy logic here is pure and tested.

// EditorInfo is the shared contract (src/lib/file-actions.ts) — main fills it here.
export type { EditorInfo } from "../src/lib/file-actions"

// Friendly display name for a CLI binary (the first word of the openPath template).
// Unknown binaries fall back to the bare command so the label still says something.
export function editorDisplayName(cmd: string): string {
  const base = cmd.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase()
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
  return known[base] ?? cmd
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
