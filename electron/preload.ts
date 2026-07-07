import { contextBridge, ipcRenderer } from "electron"

const api = {
  ptySpawn: (opts: { id: string; cols: number; rows: number; shell: string; args: string[] }) =>
    ipcRenderer.invoke("pty:spawn", opts),

  onPtyData: (id: string, cb: (data: Uint8Array) => void) => {
    const channel = `pty:data:${id}`
    const listener = (_e: unknown, data: Uint8Array) => cb(data)
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
}

contextBridge.exposeInMainWorld("smterm", api)

export type SmtermApi = typeof api
