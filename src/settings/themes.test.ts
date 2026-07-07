import { describe, it, expect } from "vitest"
import { THEMES, getTheme, applyThemeVars } from "./themes"

const UI_KEYS = [
  "bg",
  "panel",
  "elev",
  "border",
  "border2",
  "text",
  "dim",
  "faint",
  "accent",
  "amber",
  "red",
  "blue",
] as const

describe("themes", () => {
  it("getTheme falls back to minimal-dark for unknown names", () => {
    expect(getTheme("does-not-exist").name).toBe("minimal-dark")
    expect(getTheme("tokyo-night").name).toBe("tokyo-night")
  })

  it("every theme has a full token set + terminal palette", () => {
    expect(Object.keys(THEMES)).toEqual(
      expect.arrayContaining(["minimal-dark", "tokyo-night", "catppuccin", "gruvbox"]),
    )
    for (const theme of Object.values(THEMES)) {
      expect(theme.label).toBeTruthy()
      const ui = theme.ui as Record<string, string>
      for (const key of UI_KEYS) expect(ui[key]).toMatch(/#|rgb/)
      expect(theme.terminal.background).toBeTruthy()
      expect(theme.terminal.foreground).toBeTruthy()
    }
  })

  it("applyThemeVars writes CSS custom properties on :root", () => {
    applyThemeVars(getTheme("tokyo-night"))
    const root = document.documentElement.style
    expect(root.getPropertyValue("--bg")).toBe("#1a1b26")
    expect(root.getPropertyValue("--accent")).toBe("#9ece6a")
    expect(root.getPropertyValue("--border2")).toBeTruthy()
  })
})
