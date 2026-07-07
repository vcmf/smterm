import { app, BrowserWindow, ipcMain, shell, Notification } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import * as pty from "node-pty"
import type { IPty } from "node-pty"

const dir = path.dirname(fileURLToPath(import.meta.url))

const ptys = new Map<string, IPty>()

function defaultShell(): string {
  return process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "/bin/zsh")
}

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
  // PTY — one node-pty per session; stream output back over pty:data:<id>.
  ipcMain.handle(
    "pty:spawn",
    (event, opts: { id: string; cols: number; rows: number; shell: string; args: string[] }) => {
      const proc = pty.spawn(opts.shell || defaultShell(), opts.args ?? [], {
        name: "xterm-256color",
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
      })
      proc.onData((data) => event.sender.send(`pty:data:${opts.id}`, data))
      proc.onExit(() => ptys.delete(opts.id))
      ptys.set(opts.id, proc)
    },
  )
  ipcMain.on("pty:write", (_e, id: string, data: string) => ptys.get(id)?.write(data))
  ipcMain.on("pty:resize", (_e, id: string, cols: number, rows: number) => {
    try {
      ptys.get(id)?.resize(cols, rows)
    } catch {
      // ignore transient 0-size during layout
    }
  })
  ipcMain.on("pty:kill", (_e, id: string) => {
    ptys.get(id)?.kill()
    ptys.delete(id)
  })

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

app.on("before-quit", () => {
  for (const p of ptys.values()) {
    try {
      p.kill()
    } catch {
      // already gone
    }
  }
  ptys.clear()
})
