// Renderer-side platform sniff — synchronous (store.platform arrives async via IPC).
export const isMac = /mac/i.test(navigator.userAgent)
export const isWindows = /win/i.test(navigator.userAgent)

/** The new-surface shortcut label for this platform. */
export const newSurfaceKey = isMac ? "⌘T" : "Ctrl+Shift+T"
