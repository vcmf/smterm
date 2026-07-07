import type { ITheme } from "@xterm/xterm"

/** UI tokens become CSS custom properties; `terminal` is xterm's theme object.
 *  Token set follows the `mux` design spec (see design_handoff_mux_terminal). */
export interface Theme {
  name: string
  label: string
  ui: {
    bg: string // window base
    panel: string // bars, sidebar, panes
    elev: string // hover/active surfaces, cards
    border: string // hairline dividers
    border2: string // stronger borders (active tab, keycaps)
    text: string // primary text
    dim: string // secondary text
    faint: string // tertiary text / disabled
    accent: string // running / brand (green)
    amber: string // waiting / approval
    red: string // error / removed
    blue: string // human / info
  }
  terminal: ITheme
}

const minimalDark: Theme = {
  name: "minimal-dark",
  label: "Minimal Dark",
  ui: {
    bg: "#0b0b0d",
    panel: "#0f0f12",
    elev: "#17171b",
    border: "rgba(255,255,255,0.07)",
    border2: "rgba(255,255,255,0.12)",
    text: "#e8e8ea",
    dim: "#9a9aa2",
    faint: "#5c5c64",
    accent: "#4ec97a",
    amber: "#e0a94a",
    red: "#f0625f",
    blue: "#6aa0f0",
  },
  terminal: {
    background: "#0b0b0d",
    foreground: "#e8e8ea",
    cursor: "#4ec97a",
    selectionBackground: "rgba(120,200,150,0.25)",
    black: "#2a2a2e",
    red: "#f0625f",
    green: "#4ec97a",
    yellow: "#e0a94a",
    blue: "#6aa0f0",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#e8e8ea",
    brightBlack: "#5c5c64",
    brightRed: "#f0625f",
    brightGreen: "#4ec97a",
    brightYellow: "#e0a94a",
    brightBlue: "#6aa0f0",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
}

const tokyoNight: Theme = {
  name: "tokyo-night",
  label: "Tokyo Night",
  ui: {
    bg: "#1a1b26",
    panel: "#16161e",
    elev: "#20212f",
    border: "rgba(255,255,255,0.07)",
    border2: "rgba(255,255,255,0.12)",
    text: "#c0caf5",
    dim: "#7982a9",
    faint: "#565f89",
    accent: "#9ece6a",
    amber: "#e0af68",
    red: "#f7768e",
    blue: "#7aa2f7",
  },
  terminal: {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#9ece6a",
    selectionBackground: "rgba(122,162,247,0.25)",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
}

const catppuccin: Theme = {
  name: "catppuccin",
  label: "Catppuccin Mocha",
  ui: {
    bg: "#1e1e2e",
    panel: "#181825",
    elev: "#313244",
    border: "rgba(255,255,255,0.07)",
    border2: "rgba(255,255,255,0.12)",
    text: "#cdd6f4",
    dim: "#a6adc8",
    faint: "#6c7086",
    accent: "#a6e3a1",
    amber: "#f9e2af",
    red: "#f38ba8",
    blue: "#89b4fa",
  },
  terminal: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#a6e3a1",
    selectionBackground: "rgba(137,180,250,0.25)",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
}

const gruvbox: Theme = {
  name: "gruvbox",
  label: "Gruvbox",
  ui: {
    bg: "#1d2021",
    panel: "#282828",
    elev: "#32302f",
    border: "rgba(255,255,255,0.07)",
    border2: "rgba(255,255,255,0.12)",
    text: "#ebdbb2",
    dim: "#a89984",
    faint: "#7c6f64",
    accent: "#b8bb26",
    amber: "#fabd2f",
    red: "#fb4934",
    blue: "#83a598",
  },
  terminal: {
    background: "#1d2021",
    foreground: "#ebdbb2",
    cursor: "#b8bb26",
    selectionBackground: "rgba(131,165,152,0.25)",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
}

export const THEMES: Record<string, Theme> = {
  "minimal-dark": minimalDark,
  "tokyo-night": tokyoNight,
  catppuccin,
  gruvbox,
}

export const getTheme = (name: string): Theme => THEMES[name] ?? minimalDark

/** Push a theme's UI tokens onto :root as CSS custom properties. */
export function applyThemeVars(theme: Theme) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.ui)) {
    // camelCase token → --kebab-case CSS var (border2 → --border2).
    const varName = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    root.style.setProperty(`--${varName}`, value)
  }
}
