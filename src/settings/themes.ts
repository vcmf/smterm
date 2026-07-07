import type { ITheme } from "@xterm/xterm"

/** UI tokens become CSS custom properties; `terminal` is xterm's theme object. */
export interface Theme {
  name: string
  ui: {
    bg: string
    bgElevated: string
    fg: string
    fgMuted: string
    border: string
    accent: string
    hover: string
    controlBg: string
    controlFg: string
    controlHover: string
  }
  terminal: ITheme
}

const dark: Theme = {
  name: "dark",
  ui: {
    bg: "#1e1e1e",
    bgElevated: "#252526",
    fg: "#d4d4d4",
    fgMuted: "#969696",
    border: "#1a1a1a",
    accent: "#007acc",
    hover: "#ffffff22",
    controlBg: "#3c3c3c",
    controlFg: "#dddddd",
    controlHover: "#4c4c4c",
  },
  terminal: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: "#264f78",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
  },
}

const light: Theme = {
  name: "light",
  ui: {
    bg: "#ffffff",
    bgElevated: "#f3f3f3",
    fg: "#1f1f1f",
    fgMuted: "#6e6e6e",
    border: "#e0e0e0",
    accent: "#005fb8",
    hover: "#00000010",
    controlBg: "#e7e7e7",
    controlFg: "#1f1f1f",
    controlHover: "#dcdcdc",
  },
  terminal: {
    background: "#ffffff",
    foreground: "#1f1f1f",
    cursor: "#000000",
    selectionBackground: "#add6ff",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#b5ba00",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  },
}

export const THEMES: Record<string, Theme> = { dark, light }

export const getTheme = (name: string): Theme => THEMES[name] ?? dark

/** Push a theme's UI tokens onto :root as CSS custom properties. */
export function applyThemeVars(theme: Theme) {
  const root = document.documentElement
  const u = theme.ui
  root.style.setProperty("--bg", u.bg)
  root.style.setProperty("--bg-elevated", u.bgElevated)
  root.style.setProperty("--fg", u.fg)
  root.style.setProperty("--fg-muted", u.fgMuted)
  root.style.setProperty("--border", u.border)
  root.style.setProperty("--accent", u.accent)
  root.style.setProperty("--hover", u.hover)
  root.style.setProperty("--control-bg", u.controlBg)
  root.style.setProperty("--control-fg", u.controlFg)
  root.style.setProperty("--control-hover", u.controlHover)
}
