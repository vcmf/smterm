import { app, BrowserWindow, ipcMain, shell, Notification, dialog } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import * as pty from "node-pty"
import type { IPty } from "node-pty"
import { watch } from "chokidar"
import { listShells, buildInjection } from "./shell-integration"
import { gitStatus, gitDiff } from "./git"
import { OutputCoalescer } from "./coalescer"

const dir = path.dirname(fileURLToPath(import.meta.url))

const ptys = new Map<string, IPty>()
const coalescers = new Map<string, OutputCoalescer>()
let mainWindow: BrowserWindow | null = null
let quitConfirmed = false

// PTY output batching (see electron/coalescer.ts + PERF.md).
const PTY_FLUSH_MS = 4
const PTY_MAX_FLUSH_BYTES = 256 * 1024

function defaultShell(): string {
  return process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "/bin/zsh")
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    title: "smterm",
    backgroundColor: "#0b0b0d",
    frame: false, // frameless — the app draws its own top bar + window controls
    webPreferences: {
      preload: path.join(dir, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow the ESM preload + node-pty access in main
    },
  })

  mainWindow = win
  win.on("closed", () => {
    mainWindow = null
  })

  // Tell the renderer when maximize state changes (custom controls swap icon).
  const sendMax = () => win.webContents.send("window:maximize-change", win.isMaximized())
  win.on("maximize", sendMax)
  win.on("unmaximize", sendMax)

  // Load-test mode: surface the renderer's [PERF] report lines on stdout.
  if (process.env.SMTERM_PERF === "1") {
    win.webContents.on("console-message", (_e, _l, message) => {
      if (message.startsWith("[PERF]")) console.log(message)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(dir, "../renderer/index.html"))
  }
}

// Live-reload settings.json when it changes (GUI write or hand-edit).
function startSettingsWatcher() {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  watch(p, { ignoreInitial: true }).on("all", () => {
    mainWindow?.webContents.send("settings-changed")
  })
}

// ── settings.json (source of truth) ────────────────────────────────
function settingsPath(): string {
  const base =
    process.platform === "win32"
      ? path.join(process.env.APPDATA ?? os.homedir(), "smterm")
      : path.join(os.homedir(), ".config", "smterm")
  return path.join(base, "settings.json")
}

function configDir(): string {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA ?? os.homedir(), "smterm")
    : path.join(os.homedir(), ".config", "smterm")
}

function workspacePath(): string {
  return path.join(configDir(), "workspace.json")
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
    (
      event,
      opts: {
        id: string
        cols: number
        rows: number
        shell: string
        args: string[]
        cwd?: string
      },
    ) => {
      const shellCmd = opts.shell || defaultShell()
      const inj = buildInjection(shellCmd)
      const startCwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
      const proc = pty.spawn(shellCmd, [...(opts.args ?? []), ...(inj?.args ?? [])], {
        name: "xterm-256color",
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: startCwd,
        env: { ...process.env, ...(inj?.env ?? {}) } as Record<string, string>,
      })
      const send = (data: string) => {
        if (!event.sender.isDestroyed()) event.sender.send(`pty:data:${opts.id}`, data)
      }
      if (process.env.SMTERM_NO_COALESCE === "1") {
        // A/B baseline: one IPC message per node-pty chunk (the old path).
        proc.onData(send)
        proc.onExit(() => ptys.delete(opts.id))
      } else {
        // Coalesce output into fewer IPC messages.
        const coalescer = new OutputCoalescer(PTY_FLUSH_MS, PTY_MAX_FLUSH_BYTES, send)
        coalescers.set(opts.id, coalescer)
        proc.onData((data) => coalescer.push(data))
        proc.onExit(() => {
          coalescer.flush() // don't lose the final output
          coalescers.delete(opts.id)
          ptys.delete(opts.id)
        })
      }
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
    coalescers.get(id)?.dispose()
    coalescers.delete(id)
    ptys.get(id)?.kill()
    ptys.delete(id)
  })

  // Shells — per-OS defaults + WSL distro enumeration.
  ipcMain.handle("shells:list", async () => listShells())

  // Frameless window controls.
  ipcMain.on("window:minimize", () => mainWindow?.minimize())
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on("window:close", () => app.quit()) // single-window app: close ⇒ quit (guarded)
  ipcMain.handle("window:is-maximized", async () => mainWindow?.isMaximized() ?? false)

  // Git — working-tree status + per-file diff for the changes panel.
  ipcMain.handle("git:status", async (_e, cwd: string) => gitStatus(cwd))
  ipcMain.handle("git:diff", async (_e, cwd: string, file: string) => gitDiff(cwd, file))

  // Perf: process CPU/memory metrics + whether we're in load-test mode.
  ipcMain.handle("app:metrics", async () =>
    app.getAppMetrics().map((m) => ({
      type: m.type,
      pid: m.pid,
      cpu: m.cpu?.percentCPUUsage ?? 0,
      memoryKB: m.memory?.workingSetSize ?? 0,
    })),
  )
  ipcMain.handle("app:perf-mode", async () => process.env.SMTERM_PERF === "1")

  // Platform label for the status bar (macOS / Windows / Linux).
  ipcMain.handle("platform:info", async () => {
    const label =
      process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux"
    return { platform: process.platform, label, release: os.release() }
  })

  // Settings.
  ipcMain.handle("settings:read", async () => readSettings())
  ipcMain.handle("settings:write", async (_e, contents: string) => writeSettings(contents))
  ipcMain.handle("settings:path", async () => settingsPath())

  // Workspace (persisted layout for VS Code-style restore).
  ipcMain.handle("workspace:read", async () => {
    try {
      return fs.readFileSync(workspacePath(), "utf8")
    } catch {
      return ""
    }
  })
  ipcMain.handle("workspace:write", async (_e, contents: string) => {
    try {
      fs.mkdirSync(configDir(), { recursive: true })
      fs.writeFileSync(workspacePath(), contents)
    } catch {
      // best-effort
    }
  })

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
  startSettingsWatcher()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

function killAllPtys() {
  for (const c of coalescers.values()) c.dispose()
  coalescers.clear()
  for (const p of ptys.values()) {
    try {
      p.kill()
    } catch {
      // already gone
    }
  }
  ptys.clear()
}

// Is the quit-confirmation prompt enabled? (reads settings.json live)
function confirmQuitEnabled(): boolean {
  try {
    return (JSON.parse(readSettings() || "{}") as { confirmQuit?: boolean }).confirmQuit !== false
  } catch {
    return true
  }
}

// Persist "don't warn again" back into settings.json (merge, best-effort).
function disableConfirmQuit() {
  try {
    const s = JSON.parse(readSettings() || "{}") as Record<string, unknown>
    s.confirmQuit = false
    writeSettings(`${JSON.stringify(s, null, 2)}\n`)
  } catch {
    // best-effort
  }
}

// Guard quit (⌘Q or the close button) when live sessions would be killed.
app.on("before-quit", (e) => {
  if (quitConfirmed || ptys.size === 0 || !confirmQuitEnabled() || !mainWindow) {
    killAllPtys()
    return
  }
  e.preventDefault()
  const n = ptys.size
  void dialog
    .showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Cancel", "Quit"],
      defaultId: 1,
      cancelId: 0,
      message: "Quit smterm?",
      detail: `This closes ${n} running session${n === 1 ? "" : "s"} and their processes.`,
      checkboxLabel: "Don't warn again",
      checkboxChecked: false,
      noLink: true,
    })
    .then(({ response, checkboxChecked }) => {
      if (response !== 1) return // Cancel
      if (checkboxChecked) disableConfirmQuit()
      quitConfirmed = true
      app.quit()
    })
})
