import { app, BrowserWindow, ipcMain, shell, Notification } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const dir = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    title: "smterm",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(dir, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow the ESM preload + node-pty access in main
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(dir, "../renderer/index.html"))
  }
}

// ── settings.json (source of truth) ────────────────────────────────
function settingsPath(): string {
  const base =
    process.platform === "win32"
      ? path.join(process.env.APPDATA ?? os.homedir(), "smterm")
      : path.join(os.homedir(), ".config", "smterm")
  return path.join(base, "settings.json")
}

function readSettings(): string {
  try {
    return fs.readFileSync(settingsPath(), "utf8")
  } catch {
    return ""
  }
}

function writeSettings(contents: string): void {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, contents)
}

function registerIpc() {
  // PTY — stubbed in P1; real node-pty lands in P3.
  ipcMain.handle("pty:spawn", async () => {})
  ipcMain.on("pty:write", () => {})
  ipcMain.on("pty:resize", () => {})
  ipcMain.on("pty:kill", () => {})

  // Shells — minimal default in P1; full resolution + WSL in P4.
  ipcMain.handle("shells:list", async () => {
    const isWin = process.platform === "win32"
    const shellCmd = process.env.SHELL ?? (isWin ? "powershell.exe" : "/bin/zsh")
    return [
      {
        id: "default",
        label: shellCmd.split(/[\\/]/).pop() ?? "shell",
        command: shellCmd,
        args: [],
      },
    ]
  })

  // Settings.
  ipcMain.handle("settings:read", async () => readSettings())
  ipcMain.handle("settings:write", async (_e, contents: string) => writeSettings(contents))
  ipcMain.handle("settings:path", async () => settingsPath())

  // Links + notifications.
  ipcMain.on("open-external", (_e, url: string) => void shell.openExternal(url))
  ipcMain.on("open-path", (_e, p: string) => void shell.openPath(p))
  ipcMain.on("notify", (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
