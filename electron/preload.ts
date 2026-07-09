import { contextBridge, ipcRenderer } from "electron"

const api = {
  ptySpawn: (opts: { id: string; cols: number; rows: number; shell: string; args: string[] }) =>
    ipcRenderer.invoke("pty:spawn", opts),

  onPtyData: (id: string, cb: (data: string) => void) => {
    const channel = `pty:data:${id}`
    const listener = (_e: unknown, data: string) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  ptyWrite: (id: string, data: string) => ipcRenderer.send("pty:write", id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send("pty:resize", id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.send("pty:kill", id),

  listShells: () => ipcRenderer.invoke("shells:list"),

  readSettings: () => ipcRenderer.invoke("settings:read") as Promise<string>,
  writeSettings: (contents: string) => ipcRenderer.invoke("settings:write", contents),
  settingsPath: () => ipcRenderer.invoke("settings:path") as Promise<string>,
  onSettingsChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on("settings-changed", listener)
    return () => ipcRenderer.removeListener("settings-changed", listener)
  },

  openExternal: (url: string) => ipcRenderer.send("open-external", url),
  openPath: (p: string) => ipcRenderer.send("open-path", p),
  notify: (title: string, body: string) => ipcRenderer.send("notify", title, body),

  clipboardWrite: (text: string) => ipcRenderer.send("clipboard:write", text),
  clipboardRead: () => ipcRenderer.invoke("clipboard:read") as Promise<string>,

  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
  onMaximizeChange: (cb: (max: boolean) => void) => {
    const listener = (_e: unknown, max: boolean) => cb(max)
    ipcRenderer.on("window:maximize-change", listener)
    return () => ipcRenderer.removeListener("window:maximize-change", listener)
  },

  platformInfo: () =>
    ipcRenderer.invoke("platform:info") as Promise<{
      platform: string
      label: string
      release: string
    }>,

  gitStatus: (cwd: string) => ipcRenderer.invoke("git:status", cwd),
  gitDiff: (cwd: string, file: string) => ipcRenderer.invoke("git:diff", cwd, file),

  readWorkspace: () => ipcRenderer.invoke("workspace:read") as Promise<string>,
  writeWorkspace: (contents: string) => ipcRenderer.invoke("workspace:write", contents),

  appMetrics: () => ipcRenderer.invoke("app:metrics"),
  perfMode: () => ipcRenderer.invoke("app:perf-mode") as Promise<boolean>,
}

contextBridge.exposeInMainWorld("smterm", api)

export type SmtermApi = typeof api
