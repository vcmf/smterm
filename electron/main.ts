import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
  dialog,
  powerMonitor,
  clipboard,
  nativeImage,
} from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { StringDecoder } from "node:string_decoder"
import * as pty from "node-pty"
import type { IPty } from "node-pty"
import { watch } from "chokidar"
import {
  listShells,
  buildInjection,
  isWslShell,
  wslCdArgs,
  buildWslInjection,
  defaultWslDistro,
} from "./shell-integration"
import { gitStatus, gitDiff } from "./git"
import { OutputCoalescer } from "./coalescer"
import { OutputBuffer } from "./output-buffer"
import { appendDiag } from "./diagnostics"
import { applyLoginShellEnv } from "./shell-env"
import { buildEditorCommand, winQuote } from "./editor-command"
import { orderMacEditors, planEditor, type EditorPlan, type EditorInfo } from "./editor-detect"
import { startHookWatcher } from "./agent-hooks"
import type { AgentEvent } from "../src/lib/agent-graph"
import { buildHookSettings } from "./hook-writer"
import { toDirListing } from "../src/lib/dir-listing"
import { wslUncCandidates, winToMnt } from "./wsl-paths"
import type { WslContext } from "../src/lib/wsl"
import {
  classifyPreview,
  PREVIEW_READ_CAP,
  PREVIEW_MAX_SIZE,
  type PreviewData,
} from "../src/lib/file-preview"

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
// Paths to the scoped Claude Code hook-settings files the `claude` shell wrapper loads
// (set once the file-drop watcher is up). null ⇒ agents board stays empty. The WSL variant
// (Windows only) points the drop dir at a /mnt/c path an in-WSL claude can write.
let hookSettingsPath: string | null = null
let hookSettingsPathWsl: string | null = null
let hookWatcher: { close: () => Promise<void> } | null = null
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

// The app icon. Packaged builds get it from the bundle (electron-builder → build/icon.*),
// but in dev Electron shows its default icon unless we set it at runtime, so point at the
// source PNG in build/ (app path = project root in dev). Returns null if not found.
// Memoised — the PNG is decoded once and reused by both the window and the dock.
let cachedIcon: Electron.NativeImage | null | undefined
function appIcon(): Electron.NativeImage | null {
  if (cachedIcon !== undefined) return cachedIcon
  const p = path.join(app.getAppPath(), "build", "icon.png")
  if (!fs.existsSync(p)) return (cachedIcon = null)
  const img = nativeImage.createFromPath(p)
  return (cachedIcon = img.isEmpty() ? null : img)
}

function createWindow() {
  const icon = appIcon()
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    title: "smterm",
    backgroundColor: "#0b0b0d",
    frame: false, // frameless — the app draws its own top bar + window controls
    ...(icon ? { icon } : {}), // window/taskbar icon (win/linux; macOS uses the dock icon)
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
// Start the file-drop watcher + write the scoped settings file(s). Best-effort: on any
// failure the board just stays empty (never blocks startup or the terminal). Claude writes
// each event as a file into `hook-events/`; the watcher reads + deletes them (agent-hooks).
// No ports/networking — so nothing can go stale, and it crosses the WSL boundary.
async function startAgentObservability(): Promise<void> {
  try {
    const cfg = configDir()
    // Per-launch nonce as the drop-dir name: a foreign local process can't guess where to
    // drop spoofed events (restores the auth boundary the old token gave), and it clears any
    // stale drops from a previous run for free. Wipe the parent so old nonces don't pile up.
    const eventsRoot = path.join(cfg, "hook-events")
    fs.rmSync(eventsRoot, { recursive: true, force: true })
    const eventsDir = path.join(eventsRoot, randomUUID())
    fs.mkdirSync(eventsDir, { recursive: true })
    hookWatcher = await startHookWatcher({
      dir: eventsDir,
      onBatch: (events: AgentEvent[]) => mainWindow?.webContents.send("agents:events", events),
    })
    // Native settings: the drop dir as a host path.
    const nativePath = path.join(cfg, "claude-hooks.json")
    fs.writeFileSync(nativePath, buildHookSettings(eventsDir))
    hookSettingsPath = nativePath
    // WSL variant (Windows only): same physical dir, addressed via /mnt/c so an in-WSL
    // `claude` can write into it. SMTERM_CLAUDE_SETTINGS is WSLENV-forwarded with /p, so
    // this file's Windows path is translated for claude to read.
    const mnt = process.platform === "win32" ? winToMnt(eventsDir) : null
    if (mnt) {
      const wslPath = path.join(cfg, "claude-hooks.wsl.json")
      fs.writeFileSync(wslPath, buildHookSettings(mnt))
      hookSettingsPathWsl = wslPath
    }
    diag("agent-hooks-up", { dir: eventsDir })
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
      // Let the injected `claude` wrapper route through our scoped hook settings, and tag
      // this pane so the agents board knows which pane each session runs in (M6). WSL panes
      // use the /mnt/c-addressed variant; wslInjection forwards both vars over WSLENV (the
      // settings path with /p so its Windows form is translated for claude inside WSL).
      if (hookSettingsPath) {
        spawnEnv.SMTERM_CLAUDE_SETTINGS = wsl
          ? (hookSettingsPathWsl ?? hookSettingsPath)
          : hookSettingsPath
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
  // Just whether an image is present — via the cheap format list, NOT readImage() (which
  // decodes the whole bitmap, slow on Windows). We never need the bytes: an image paste
  // sends Ctrl+V so the running program reads the clipboard image itself (see pasteInto).
  ipcMain.handle("clipboard:has-image", async () =>
    clipboard.availableFormats().some((f) => f.startsWith("image/")),
  )

  // Files browser: list ONE directory (lazy — never a recursive walk). Sorting /
  // .git-filter / cap live in the pure, tested lib/dir-listing; here we just gather
  // entries (resolving symlinked dirs via stat so they browse, not open as files).
  ipcMain.handle("fs:readdir", async (_e, dir: string, wsl?: WslContext) => {
    // A WSL pane's dir is a Linux path the host can't see — read it through the distro's
    // UNC share (resolving the default distro's name when the pane has no explicit -d),
    // trying \\wsl.localhost\ then legacy \\wsl$\. Non-WSL panes read the host path.
    const candidates = wsl ? wslUncCandidates(wsl.distro ?? defaultWslDistro(), dir) : []
    for (const target of candidates.length ? candidates : [dir]) {
      try {
        const ents = await fs.promises.readdir(target, { withFileTypes: true })
        const raw = await Promise.all(
          ents.map(async (e) => {
            let isDir = e.isDirectory()
            if (e.isSymbolicLink()) {
              // isDirectory() is false for a symlink even when it targets a dir — stat
              // the target so a symlinked directory expands instead of opening.
              try {
                isDir = (await fs.promises.stat(path.join(target, e.name))).isDirectory()
              } catch {
                // dangling link → treat as a file
              }
            }
            return { name: e.name, isDir }
          }),
        )
        return toDirListing(raw)
      } catch {
        // this candidate didn't resolve (wrong share form, or unreadable) — try the next
      }
    }
    return { entries: [], truncated: false }
  })

  // Read a file for the preview popup: guard the size, read up to the cap, and
  // classify text vs binary. Best-effort — any failure returns an error kind.
  ipcMain.handle("fs:read-preview", async (_e, p: string): Promise<PreviewData> => {
    try {
      const st = await fs.promises.stat(p)
      if (!st.isFile()) return { kind: "error", message: "Not a file" }
      const size = st.size
      if (size > PREVIEW_MAX_SIZE) return { kind: "too-large", size }
      const len = Math.min(size, PREVIEW_READ_CAP)
      const buf = Buffer.alloc(len)
      let bytesRead = 0
      const fh = await fs.promises.open(p, "r")
      try {
        if (len > 0) ({ bytesRead } = await fh.read(buf, 0, len, 0))
      } finally {
        await fh.close()
      }
      // Only the bytes actually read — a short read must not leave zero-filled tail
      // (→ false 'binary'), and the decoder must not see it (→ trailing garbage).
      const chunk = buf.subarray(0, bytesRead)
      const meta = classifyPreview(size, bytesRead, chunk.includes(0))
      if (meta.kind === "binary") return { kind: "binary", size }
      // StringDecoder drops a dangling multi-byte sequence at the truncation boundary
      // (never .end()ed) instead of emitting a � replacement char.
      const text = new StringDecoder("utf8").write(chunk)
      return { kind: "text", text, truncated: meta.truncated, size }
    } catch (err) {
      return { kind: "error", message: String(err) }
    }
  })

  // Native folder picker for the Files-panel root; returns null if cancelled.
  ipcMain.handle("dialog:pick-directory", async (_e, defaultPath?: string) => {
    try {
      const opts: Electron.OpenDialogOptions = {
        properties: ["openDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      }
      const res = await (mainWindow
        ? dialog.showOpenDialog(mainWindow, opts)
        : dialog.showOpenDialog(opts))
      return res.canceled ? null : (res.filePaths[0] ?? null)
    } catch {
      return null // e.g. window destroyed mid-dialog — never throw into Electron
    }
  })
  // Validate a typed path is an existing directory (Files-panel root entry).
  ipcMain.handle("fs:is-dir", async (_e, p: string) => {
    try {
      return (await fs.promises.stat(p)).isDirectory()
    } catch {
      return false
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
  // Reveal a file/folder in the OS file manager (Finder/Explorer/etc.) — always works,
  // no editor/PATH dependency, so the file context menu can rely on it.
  ipcMain.on("file:reveal", (_e, p: string) => shell.showItemInFolder(p))
  // Can the configured editor actually open a file? Drives the menu label/enabled state.
  ipcMain.handle("editor:info", async (): Promise<EditorInfo> => {
    const plan = resolveEditor()
    return { available: plan.kind !== "none", name: plan.name }
  })
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

// Is `cmd` an executable on the current PATH? (absolute paths checked directly).
// process.env carries the login-shell PATH imported at startup (shell-env.ts).
function commandOnPath(cmd: string): boolean {
  const test = (p: string) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (path.isAbsolute(cmd)) return test(cmd)
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!d) continue
    for (const ext of exts) if (test(path.join(d, cmd + ext))) return true
  }
  return false
}

// macOS only: the best installed editor .app to `open -a`, checking both the
// system and per-user app folders (auto-updaters often land in ~/Applications).
function macAppFor(cmd: string): { name: string; app: string } | null {
  if (process.platform !== "darwin") return null
  const dirs = ["/Applications", path.join(os.homedir(), "Applications")]
  for (const e of orderMacEditors(cmd)) {
    if (dirs.some((d) => fs.existsSync(path.join(d, `${e.app}.app`)))) {
      return { name: e.name, app: e.app }
    }
  }
  return null
}

// Resolve the open strategy via the pure planEditor (probes injected). Memoised with
// a short TTL: bounds the synchronous PATH walk to ~once per window on rapid clicks,
// while still noticing an editor installed mid-session within a few seconds.
let editorPlanCache: { template: string; at: number; plan: EditorPlan } | null = null
const EDITOR_PLAN_TTL_MS = 3000
function resolveEditor(): EditorPlan {
  const template = openPathTemplate().trim()
  const now = Date.now()
  if (
    editorPlanCache &&
    editorPlanCache.template === template &&
    now - editorPlanCache.at < EDITOR_PLAN_TTL_MS
  ) {
    return editorPlanCache.plan
  }
  const plan = planEditor(template, { onPath: commandOnPath, macAppFor })
  editorPlanCache = { template, at: now, plan }
  return plan
}

// Open a file in the configured editor. Falls back to revealing it in the OS file
// manager when no editor is available or the launch fails — so a click always does
// something visible (never the silent no-op of shell.openPath on a source file).
function openFile(cwd: string, file: string, line?: number, col?: number): void {
  const abs = resolveHostPath(cwd, file)
  const reveal = () => shell.showItemInFolder(abs)
  const plan = resolveEditor()
  try {
    if (plan.kind === "osDefault") {
      void shell.openPath(abs)
      return
    }
    if (plan.kind === "none") {
      reveal()
      return
    }
    // On Windows, editors are `.cmd` shims that `spawn` can't exec without a shell.
    const isWin = process.platform === "win32"
    const [cmd, args] =
      plan.kind === "macApp"
        ? (["open", ["-a", plan.app, abs]] as const)
        : (() => {
            const built = buildEditorCommand(openPathTemplate(), { file: abs, line, col })!
            return [built.cmd, isWin ? built.args.map(winQuote) : built.args] as const
          })()
    const child = spawn(cmd, args as string[], {
      detached: true,
      stdio: "ignore",
      env: process.env,
      shell: isWin && plan.kind === "template",
      windowsHide: true,
    })
    child.on("error", reveal) // launch failed → reveal instead of a silent no-op
    child.unref()
  } catch {
    reveal()
  }
}

// App identity. Packaged builds get this from the bundle (electron-builder productName),
// but in dev the app runs from Electron.app, so the dock/menu read "Electron" unless we
// set it here. AppUserModelId groups the taskbar + routes notifications on Windows.
app.setName("smterm")
app.setAppUserModelId("com.smterm.app")

// Single-instance guard. A second launch — an update-relaunch racing the old process, or
// a stray double-click — would start a SECOND hook receiver on a different ephemeral port
// and overwrite the shared claude-hooks.json. When the port-owning instance quits, the
// survivor's Claude sessions keep POSTing to the now-dead port → `connect ECONNREFUSED`
// on every hook, spamming the agent's output. Hold a lock: the second instance just focuses
// the running window and quits, so there's always exactly one receiver / one config writer.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
app.on("second-instance", () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return // second instance — it's quitting; start nothing
  // GUI-launched apps (Finder/Dock) inherit a bare launchd PATH, so shells can't find
  // Homebrew/cargo tools (starship, etc.). Import the login shell's real env before any
  // PTY spawns. Only when packaged — in dev the app is launched from a terminal that
  // already has the full env, so this cost (~one shell invocation) is skipped.
  if (process.platform !== "win32" && app.isPackaged) applyLoginShellEnv(defaultShell())
  // macOS dock icon: packaged builds get it from the .app bundle, but `make run` (dev)
  // shows the default Electron icon unless we set it here.
  if (process.platform === "darwin") {
    const icon = appIcon()
    if (icon) app.dock?.setIcon(icon)
  }
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

app.on("will-quit", () => {
  diag("will-quit", { ptys: sessions.size })
  void hookWatcher?.close() // stop the file-drop watcher
})
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
