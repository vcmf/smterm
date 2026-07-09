import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
  dialog,
  powerMonitor,
  clipboard,
} from "electron"
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
import { OutputBuffer } from "./output-buffer"
import { appendDiag } from "./diagnostics"

const dir = path.dirname(fileURLToPath(import.meta.url))

// Session-survival diagnostics: log rare lifecycle/power/PTY events to a file that
// survives an app kill (see electron/diagnostics.ts). Temporary — remove once the
// lid-close trigger is confirmed. Reads configDir() lazily so it lands next to settings.
const diag = (event: string, fields?: Record<string, string | number | boolean>) =>
  appendDiag(configDir(), event, fields)

// One record per live PTY. The PTY lives in the main process, so it survives a
// renderer reload (dev HMR on resume, or a GPU-process crash) — `sender` is the
// CURRENT renderer target and is rebound on reattach; `buffer` holds recent output
// so the reloaded renderer can replay history instead of respawning the shell.
interface PtySession {
  id: string
  proc: IPty
  buffer: OutputBuffer
  sender: Electron.WebContents
  coalescer?: OutputCoalescer // absent only in the SMTERM_NO_COALESCE=1 A/B baseline
  shell: string
}
const sessions = new Map<string, PtySession>()
let mainWindow: BrowserWindow | null = null
let quitConfirmed = false

// PTY output batching (see electron/coalescer.ts + PERF.md).
const PTY_FLUSH_MS = 4
const PTY_MAX_FLUSH_BYTES = 256 * 1024
// Recent output kept per session for replay when a reloaded renderer reattaches.
const PTY_REPLAY_BYTES = 256 * 1024

// Send PTY output to the session's current renderer (skips a destroyed one).
function emit(rec: PtySession, data: string): void {
  if (!rec.sender.isDestroyed()) rec.sender.send(`pty:data:${rec.id}`, data)
}

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
  // PTY — one node-pty per session; stream output back over pty:data:<id>. When a
  // reloaded renderer asks to spawn a session that's already live, REATTACH: rebind
  // output to the new renderer and replay recent history, rather than respawn.
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
    ): { reattached: boolean } => {
      const existing = sessions.get(opts.id)
      if (existing) {
        // Reattach: point output at the new renderer, drop stale in-flight bytes
        // (they're in the buffer), resize to the new xterm, then replay history.
        existing.sender = event.sender
        existing.coalescer?.reset()
        try {
          existing.proc.resize(opts.cols || 80, opts.rows || 24)
        } catch {
          // transient 0-size during layout — a later resize settles it
        }
        emit(existing, existing.buffer.dump())
        diag("pty-reattach", { id: opts.id, pid: existing.proc.pid })
        return { reattached: true }
      }

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
      const coalesce = process.env.SMTERM_NO_COALESCE !== "1"
      const rec: PtySession = {
        id: opts.id,
        proc,
        buffer: new OutputBuffer(PTY_REPLAY_BYTES),
        sender: event.sender,
        shell: shellCmd,
      }
      if (coalesce) {
        rec.coalescer = new OutputCoalescer(PTY_FLUSH_MS, PTY_MAX_FLUSH_BYTES, (d) => emit(rec, d))
      }
      proc.onData((data) => {
        rec.buffer.push(data) // keep for replay on reattach
        if (rec.coalescer) rec.coalescer.push(data)
        else emit(rec, data) // A/B baseline: one IPC message per node-pty chunk
      })
      proc.onExit((e) => {
        diag("pty-exit", { id: opts.id, code: e.exitCode, signal: e.signal ?? 0 })
        rec.coalescer?.flush() // don't lose the final output
        sessions.delete(opts.id)
      })
      sessions.set(opts.id, rec)
      diag("pty-spawn", { id: opts.id, pid: proc.pid, shell: path.basename(shellCmd) })
      return { reattached: false }
    },
  )
  ipcMain.on("pty:write", (_e, id: string, data: string) => sessions.get(id)?.proc.write(data))
  ipcMain.on("pty:resize", (_e, id: string, cols: number, rows: number) => {
    try {
      sessions.get(id)?.proc.resize(cols, rows)
    } catch {
      // ignore transient 0-size during layout
    }
  })
  // Explicit kill (pane/tab closed) — really terminate + free the replay buffer.
  ipcMain.on("pty:kill", (_e, id: string) => {
    const rec = sessions.get(id)
    if (!rec) return
    rec.coalescer?.dispose()
    rec.buffer.clear()
    rec.proc.kill()
    sessions.delete(id)
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
    return { platform: process.platform, label, release: os.release(), home: os.homedir() }
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

  // Clipboard (copy/paste) — main owns it; renderer never imports Electron.
  ipcMain.on("clipboard:write", (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle("clipboard:read", async () => clipboard.readText())

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
  diag("boot", { pid: process.pid, version: app.getVersion() })
  // Power events tell us whether a lid-close SUSPENDS the app (suspend→resume with
  // PTYs intact) or the OS TERMINATES it (suspend, then a fresh boot with no quit).
  // `.on` is overloaded per event-name literal; cast to a plain-string signature so
  // we can register them in a loop.
  const onPower = powerMonitor.on.bind(powerMonitor) as (e: string, cb: () => void) => void
  for (const ev of ["suspend", "resume", "lock-screen", "unlock-screen", "shutdown"]) {
    onPower(ev, () => diag(`power-${ev}`, { ptys: sessions.size }))
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  diag("window-all-closed", { platform: process.platform })
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => diag("will-quit", { ptys: sessions.size }))
app.on("quit", () => diag("quit"))

function killAllPtys() {
  for (const rec of sessions.values()) {
    rec.coalescer?.dispose()
    try {
      rec.proc.kill()
    } catch {
      // already gone
    }
  }
  sessions.clear()
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
  diag("before-quit", { ptys: sessions.size, confirmed: quitConfirmed })
  if (quitConfirmed || sessions.size === 0 || !confirmQuitEnabled() || !mainWindow) {
    killAllPtys()
    return
  }
  e.preventDefault()
  const n = sessions.size
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
