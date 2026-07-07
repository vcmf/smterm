import { describe, it, expect, vi, beforeEach } from "vitest"
import { loadSettings, saveSettings, settingsPath, openSettingsFile } from "./io"
import { defaultSettings } from "./schema"
import { ipc } from "../lib/ipc"

beforeEach(() => vi.clearAllMocks())

describe("settings io", () => {
  it("loadSettings parses the file contents", async () => {
    vi.mocked(ipc.readSettings).mockResolvedValueOnce(JSON.stringify({ font: { size: 20 } }))
    const s = await loadSettings()
    expect(s.font.size).toBe(20)
    expect(s.theme).toBe(defaultSettings.theme) // merged over defaults
  })

  it("loadSettings falls back to defaults on empty/invalid", async () => {
    vi.mocked(ipc.readSettings).mockResolvedValueOnce("")
    expect((await loadSettings()).theme).toBe(defaultSettings.theme)
  })

  it("saveSettings serializes + writes via ipc", async () => {
    await saveSettings(defaultSettings)
    expect(ipc.writeSettings).toHaveBeenCalledOnce()
    const written = vi.mocked(ipc.writeSettings).mock.calls[0]![0]
    expect(JSON.parse(written).theme).toBe(defaultSettings.theme)
  })

  it("settingsPath returns the ipc path, '' on failure", async () => {
    vi.mocked(ipc.settingsPath).mockResolvedValueOnce("/cfg/settings.json")
    expect(await settingsPath()).toBe("/cfg/settings.json")
    vi.mocked(ipc.settingsPath).mockRejectedValueOnce(new Error("x"))
    expect(await settingsPath()).toBe("")
  })

  it("openSettingsFile writes then opens the path", async () => {
    vi.mocked(ipc.settingsPath).mockResolvedValueOnce("/cfg/settings.json")
    await openSettingsFile(defaultSettings)
    expect(ipc.writeSettings).toHaveBeenCalled()
    expect(ipc.openPath).toHaveBeenCalledWith("/cfg/settings.json")
  })
})
