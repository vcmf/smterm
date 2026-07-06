import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { parseSettings, serializeSettings } from "./schema";
import type { Settings } from "./schema";

/** Read + parse settings.json (tolerant; missing/invalid → defaults). */
export async function loadSettings(): Promise<Settings> {
  try {
    return parseSettings(await invoke<string>("read_settings_file"));
  } catch {
    return parseSettings("");
  }
}

/** Write settings.json (best-effort). */
export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await invoke("write_settings_file", { contents: serializeSettings(settings) });
  } catch {
    // best-effort; the app keeps its in-memory settings regardless
  }
}

export async function settingsPath(): Promise<string> {
  try {
    return await invoke<string>("settings_file_path");
  } catch {
    return "";
  }
}

/** Ensure the file exists, then open it in the OS default editor. */
export async function openSettingsFile(settings: Settings): Promise<void> {
  await saveSettings(settings);
  const path = await settingsPath();
  if (path) {
    try {
      await openPath(path);
    } catch {
      // ignore
    }
  }
}
