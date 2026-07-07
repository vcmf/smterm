import type { ShellOption } from "../types"

// The typed surface the preload exposes on window.smterm. Every renderer→main
// call goes through this one seam (keeps components portable + is the insulation
// point for a future out-of-process session daemon — see ARCHITECTURE Appendix A).
export interface SpawnOpts {
  id: string
  cols: number
  rows: number
  shell: string
  args: string[]
}

export interface Ipc {
  ptySpawn: (opts: SpawnOpts) => Promise<void>
  onPtyData: (id: string, cb: (data: Uint8Array) => void) => () => void
  ptyWrite: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  listShells: () => Promise<ShellOption[]>
  readSettings: () => Promise<string>
  writeSettings: (contents: string) => Promise<void>
  settingsPath: () => Promise<string>
  onSettingsChanged: (cb: () => void) => () => void
  openExternal: (url: string) => void
  openPath: (p: string) => void
  notify: (title: string, body: string) => void
}

declare global {
  interface Window {
    smterm: Ipc
  }
}

export const ipc: Ipc = window.smterm
