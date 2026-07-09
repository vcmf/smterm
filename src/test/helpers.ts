import { useStore } from "../store"
import { defaultSettings } from "../settings/schema"
import type { ShellOption } from "../types"

export const testShell: ShellOption = { id: "sh", label: "sh", command: "/bin/sh", args: [] }

/** Reset the singleton store to a clean initial state between tests (keeps actions). */
export function resetStore() {
  useStore.setState({
    sessions: {},
    tabs: [],
    activeTabId: null,
    shells: [testShell],
    windowFocused: true,
    settings: defaultSettings,
    settingsOpen: false,
    paletteOpen: false,
    searchOpen: false,
    diffPanelOpen: false,
    git: null,
  })
}
