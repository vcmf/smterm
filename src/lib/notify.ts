import { ipc } from "./ipc"

/** Electron handles OS notification permission in the main process. */
export async function ensureNotificationPermission(): Promise<boolean> {
  return true
}

/** Fire an OS notification (best-effort). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    ipc.notify(title, body)
  } catch {
    // best-effort
  }
}
