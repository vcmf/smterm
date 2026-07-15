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
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import * as pty from "node-pty"
import type { IPty } from "node-pty"
import { watch } from "chokidar"
import {
  listShells,
  buildInjection,
  isWslShell,
  wslCdArgs,
  buildWslInjection,
} from "./shell-integration"
import { gitStatus, gitDiff } from "./git"
import { OutputCoalescer } from "./coalescer"
import { OutputBuffer } from "./output-buffer"
import { appendDiag } from "./diagnostics"
import { applyLoginShellEnv } from "./shell-env"
import { buildEditorCommand, winQuote } from "./editor-command"
import { startHookReceiver } from "./agent-hooks"
import type { AgentEvent } from "../src/lib/agent-graph"
import { toDirListing } from "../src/lib/dir-listing"

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
// Path to the scoped Claude Code hook-settings file the `claude` shell wrapper loads
// (set once the loopback hook receiver is up). null ⇒ agents board stays empty.
let hookSettingsPath: string | null = null
let quitConfirmed = false

// PTY output batching (see electron/coalescer.ts + docs/PERF.md).
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

// ── agent observability (M6) ───────────────────────────────────────
// Build the scoped Claude Code hook-settings JSON: every event of interest POSTs
// to our loopback receiver with the shared token. `timeout: 3` is a backstop so a
// slow/dead receiver can never hang the agent (design doc §8).
function agentHookSettings(port: number, token: string): string {
  const hook = {
    type: "http",
    url: `http://127.0.0.1:${port}/`,
    // x-smterm-pane is interpolated per pane from SMTERM_PANE_ID (set in the spawn env)
    // so the receiver can tag each event with the pane it came from (board grouping +
    // click-to-focus). Env interpolation via allowedEnvVars is confirmed to work.
    headers: { "x-smterm-token": token, "x-smterm-pane": "$SMTERM_PANE_ID" },
    allowedEnvVars: ["SMTERM_PANE_ID"],
    timeout: 3,
  }
  const toolEvents = new Set(["PreToolUse", "PostToolUse"])
  const events = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "Stop",
    "Notification",
    "SubagentStart",
    "SubagentStop",
    "PreToolUse",
    "PostToolUse",
    "CwdChanged",
    "FileChanged",
  ]
  const hooks: Record<string, unknown[]> = {}
  for (const e of events)
    hooks[e] = [toolEvents.has(e) ? { matcher: "", hooks: [hook] } : { hooks: [hook] }]
  return `${JSON.stringify({ hooks }, null, 2)}\n`
}

// Start the loopback hook receiver + write the scoped settings file. Best-effort:
// on any failure the board just stays empty (never blocks startup or the terminal).
async function startAgentObservability(): Promise<void> {
  try {
    const token = randomUUID()
    const receiver = await startHookReceiver({
      token,
      onBatch: (events: AgentEvent[]) => mainWindow?.webContents.send("agents:events", events),
    })
    const p = path.join(configDir(), "claude-hooks.json")
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, agentHookSettings(receiver.port, token))
    hookSettingsPath = p
    diag("agent-hooks-up", { port: receiver.port })
  } catch (err) {
    diag("agent-hooks-failed", { err: String(err) })
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
      // WSL: the Linux shell runs inside wsl.exe. Drive the Linux start dir via wsl's
      // own --cd (home unless we have a tracked Linux path); inject our integration
      // INSIDE WSL (best-effort → OSC-133 status + OSC-7 cwd); launch wsl.exe from a
      // valid Windows dir. Local shells inject the usual way.
      const wsl = isWslShell(shellCmd)
      const inj = wsl ? buildWslInjection(opts.args ?? []) : buildInjection(shellCmd)
      const wslArgs = wsl ? wslCdArgs(opts.cwd) : []
      const startCwd = !wsl && opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir()
      // Shared-history opt-out: the injected scripts default SHARE_HISTORY on; pass
      // SMTERM_SHARE_HISTORY=0 to disable. (For WSL, wslInjection lists it in $WSLENV
      // so it crosses the boundary.)
      const spawnEnv = { ...process.env, ...(inj?.env ?? {}) } as Record<string, string>
      if (!shareHistoryEnabled()) spawnEnv.SMTERM_SHARE_HISTORY = "0"
      // Let the injected `claude` wrapper route through our scoped hook settings, and
      // tag this pane so the agents board knows which pane each session runs in (M6).
      if (hookSettingsPath && !wsl) {
        spawnEnv.SMTERM_CLAUDE_SETTINGS = hookSettingsPath
        spawnEnv.SMTERM_PANE_ID = opts.id
      }
      const proc = pty.spawn(shellCmd, [...(opts.args ?? []), ...wslArgs, ...(inj?.args ?? [])], {
        name: "xterm-256color",
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: startCwd,
        env: spawnEnv,
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
  ipcMain.handle("git:status", async (_e, cwd: string, wsl?: { distro?: string }) =>
    gitStatus(cwd, wsl),
  )
  ipcMain.handle("git:diff", async (_e, cwd: string, file: string, wsl?: { distro?: string }) =>
    gitDiff(cwd, file, wsl),
  )

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
  // Whether the clipboard holds an image (e.g. a screenshot) — the renderer uses this
  // to route ⌘V to the running program's own image paste instead of a text paste.
  ipcMain.handle("clipboard:has-image", async () => !clipboard.readImage().isEmpty())

  // Files browser: list ONE directory (lazy — never a recursive walk). Sorting /
  // .git-filter / cap live in the pure, tested lib/dir-listing; here we just gather
  // entries (resolving symlinked dirs via stat so they browse, not open as files).
  ipcMain.handle("fs:readdir", async (_e, dir: string) => {
    try {
      const ents = await fs.promises.readdir(dir, { withFileTypes: true })
      const raw = await Promise.all(
        ents.map(async (e) => {
          let isDir = e.isDirectory()
          if (e.isSymbolicLink()) {
            // isDirectory() is false for a symlink even when it targets a dir — stat
            // the target so a symlinked directory expands instead of opening.
            try {
              isDir = (await fs.promises.stat(path.join(dir, e.name))).isDirectory()
            } catch {
              // dangling link → treat as a file
            }
          }
          return { name: e.name, isDir }
        }),
      )
      return toDirListing(raw)
    } catch {
      return { entries: [], truncated: false } // unreadable / not-a-dir / WSL path → empty
    }
  })

  // Links + notifications.
  ipcMain.on("open-external", (_e, url: string) => void shell.openExternal(url))
  ipcMain.on("open-path", (_e, p: string) => void shell.openPath(p))
  ipcMain.on("notify", (_e, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })

  // Clickable file links: validate a detected path exists, and open a clicked one.
  ipcMain.handle("fs:path-exists", async (_e, cwd: string, p: string) => pathExists(cwd, p))
  ipcMain.on("file:open", (_e, cwd: string, file: string, line?: number, col?: number) =>
    openFile(cwd, file, line, col),
  )
}

// Expand a leading ~ and resolve relative to cwd → absolute host path.
function resolveHostPath(cwd: string, p: string): string {
  const expanded = p.startsWith("~/") || p === "~" ? path.join(os.homedir(), p.slice(1)) : p
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded)
}

// Does a detected path exist on the host fs? (The false-positive filter for links.)
async function pathExists(cwd: string, p: string): Promise<boolean> {
  try {
    await fs.promises.stat(resolveHostPath(cwd, p))
    return true
  } catch {
    return false
  }
}

// The editor-command template for clicked links (reads settings.json live).
function openPathTemplate(): string {
  try {
    const s = JSON.parse(readSettings() || "{}") as { openPath?: string }
    return typeof s.openPath === "string" ? s.openPath : "code -g {file}:{line}:{col}"
  } catch {
    return "code -g {file}:{line}:{col}"
  }
}

// Open a clicked file link in the configured editor; fall back to the OS default
// app if there's no editor command or the editor binary isn't found.
function openFile(cwd: string, file: string, line?: number, col?: number): void {
  const abs = resolveHostPath(cwd, file)
  const built = buildEditorCommand(openPathTemplate(), { file: abs, line, col })
  if (!built) {
    void shell.openPath(abs)
    return
  }
  try {
    // `process.env` carries the login-shell PATH imported at startup (shell-env),
    // so a GUI-launched app can still find `code`/etc. On Windows, editors are `.cmd`
    // shims that `spawn` can't exec directly — use the shell and quote args (winQuote).
    const isWin = process.platform === "win32"
    const child = spawn(built.cmd, isWin ? built.args.map(winQuote) : built.args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
      shell: isWin,
      windowsHide: true,
    })
    child.on("error", () => void shell.openPath(abs)) // editor not on PATH → OS default
    child.unref()
  } catch {
    void shell.openPath(abs)
  }
}

app.whenReady().then(async () => {
  // GUI-launched apps (Finder/Dock) inherit a bare launchd PATH, so shells can't find
  // Homebrew/cargo tools (starship, etc.). Import the login shell's real env before any
  // PTY spawns. Only when packaged — in dev the app is launched from a terminal that
  // already has the full env, so this cost (~one shell invocation) is skipped.
  if (process.platform !== "win32" && app.isPackaged) applyLoginShellEnv(defaultShell())
  registerIpc()
  // Start the hook receiver BEFORE the window so hookSettingsPath is set before the
  // renderer can request the first pty:spawn — otherwise the initial pane launches
  // without SMTERM_CLAUDE_SETTINGS and the `claude` wrapper never arms (M6).
  await startAgentObservability()
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

// Is cmux-like shared history enabled? (reads settings.json live; default on)
function shareHistoryEnabled(): boolean {
  try {
    return (JSON.parse(readSettings() || "{}") as { shareHistory?: boolean }).shareHistory !== false
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
