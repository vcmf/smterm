import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SettingsPanel } from "./settings-panel"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { resetStore } from "../test/helpers"

const st = () => useStore.getState()

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe("SettingsPanel", () => {
  it("renders all four theme options", () => {
    render(<SettingsPanel />)
    expect(screen.getByText("Settings")).toBeInTheDocument()
    for (const name of ["Minimal Dark", "Tokyo Night", "Catppuccin Mocha", "Gruvbox"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument()
    }
  })

  it("editing the font size updates the store and persists", () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "18" } })
    expect(st().settings.font.size).toBe(18)
    expect(ipc.writeSettings).toHaveBeenCalled()
  })

  it("changing the theme updates settings", () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "gruvbox" } })
    expect(st().settings.theme).toBe("gruvbox")
  })

  it("choosing a default shell persists it", () => {
    render(<SettingsPanel />)
    fireEvent.change(screen.getByLabelText("Default shell"), { target: { value: "/bin/sh" } })
    expect(st().settings.defaultShell).toBe("/bin/sh")
  })

  it("the close button dismisses the panel", () => {
    st().setSettingsOpen(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTitle("Close"))
    expect(st().settingsOpen).toBe(false)
  })
})
