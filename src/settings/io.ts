import { ipc } from "../lib/ipc"
import { parseSettings, serializeSettings } from "./schema"
import type { Settings } from "./schema"

/** Read + parse settings.json (tolerant; missing/invalid → defaults). */
export async function loadSettings(): Promise<Settings> {
  try {
    return parseSettings(await ipc.readSettings())
  } catch {
    return parseSettings("")
  }
}

/** Write settings.json (best-effort). */
export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await ipc.writeSettings(serializeSettings(settings))
  } catch {
    // best-effort; the app keeps its in-memory settings regardless
  }
}

export async function settingsPath(): Promise<string> {
  try {
    return await ipc.settingsPath()
  } catch {
    return ""
  }
}

/** Ensure the file exists, then open it in the OS default editor. */
export async function openSettingsFile(settings: Settings): Promise<void> {
  await saveSettings(settings)
  const path = await settingsPath()
  if (path) ipc.openPath(path)
}
