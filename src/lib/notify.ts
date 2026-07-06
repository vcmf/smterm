import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

/** Ensure notification permission, requesting it once. Cached after first call. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (granted !== null) return granted;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

/** Fire an OS notification (no-op if permission is denied/unavailable). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (await ensureNotificationPermission()) sendNotification({ title, body });
  } catch {
    // Notifications are best-effort; ignore failures.
  }
}
