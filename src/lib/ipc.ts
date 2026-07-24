import type { ShellOption } from "../types"
import type { WslContext } from "./wsl"
import type { AgentEvent } from "./agent-graph"
import type { DirListing } from "./dir-listing"
import type { EditorInfo } from "./file-actions"
import type { PreviewData } from "./file-preview"

// The typed surface the preload exposes on window.smterm. Every renderer→main
// call goes through this one seam (keeps components portable + is the insulation
// point for a future out-of-process session daemon — see ARCHITECTURE Appendix A).
export interface SpawnOpts {
  id: string
  cols: number
  rows: number
  shell: string
  args: string[]
  cwd?: string // start directory; falls back to $HOME in main if unset
}

export interface Ipc {
  // Resolves { reattached: true } when the session was already live in main and we
  // reconnected the (reloaded) renderer to it, replaying history, instead of spawning.
  ptySpawn: (opts: SpawnOpts) => Promise<{ reattached: boolean }>
  onPtyData: (id: string, cb: (data: string) => void) => () => void
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  listShells: () => Promise<ShellOption[]>
  readSettings: () => Promise<string>
  writeSettings: (contents: string) => Promise<void>
  settingsPath: () => Promise<string>
  onSettingsChanged: (cb: () => void) => () => void
  onAgentEvents: (cb: (events: AgentEvent[]) => void) => () => void
  openExternal: (url: string) => void
  openPath: (p: string) => void
  // Does `path` (relative to `cwd`, or absolute) exist? Validates a detected file link.
  pathExists: (cwd: string, path: string) => Promise<boolean>
  // Open a clicked file link in the configured editor (falls back to the OS default).
  openFile: (cwd: string, file: string, line?: number, col?: number) => void
  revealPath: (p: string) => void // show the file/folder in Finder/Explorer
  editorInfo: () => Promise<EditorInfo> // can the configured editor open a file?
  notify: (title: string, body: string) => void
  clipboardWrite: (text: string) => void
  clipboardRead: () => Promise<string>
  // Lazy, one directory at a time (files browser). `wsl` translates a WSL pane's Linux
  // path to a \\wsl.localhost\ UNC so the Windows host can list it.
  readdir: (dir: string, wsl?: WslContext) => Promise<DirListing>

  // Read a file for the preview popup; `wsl` reads a WSL pane's Linux path via its UNC share.
  readFilePreview: (path: string, wsl?: WslContext) => Promise<PreviewData>
  pickDirectory: (defaultPath?: string) => Promise<string | null> // native folder picker (Files root)
  pathIsDir: (p: string) => Promise<boolean> // validate a typed path is a directory

  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (max: boolean) => void) => () => void
  platformInfo: () => Promise<PlatformInfo>
  gitStatus: (cwd: string, wsl?: WslContext) => Promise<GitStatus>
  gitDiff: (cwd: string, file: string, wsl?: WslContext) => Promise<DiffLine[]>
  readWorkspace: () => Promise<string>
  writeWorkspace: (contents: string) => void
  appMetrics: () => Promise<ProcMetric[]>
  perfMode: () => Promise<boolean>
}

export interface ProcMetric {
  type: string
  pid: number
  cpu: number // percent
  memoryKB: number
}

export interface PlatformInfo {
  platform: string
  label: string
  release: string
  home: string
}

export type ChangeStatus = "M" | "A" | "D" | "R" | "?"

export interface GitFile {
  path: string
  name: string
  dir: string
  status: ChangeStatus
  add: number
  del: number
}

export interface GitStatus {
  isRepo: boolean
  root: string // repo toplevel (abs); "" when not a repo
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
  add: number
  del: number
}

export interface DiffLine {
  type: "add" | "del" | "context" | "hunk"
  text: string
  oldNo?: number
  newNo?: number
}

declare global {
  interface Window {
    smterm: Ipc
  }
}

export const ipc: Ipc = window.smterm
