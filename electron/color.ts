/** Terminal background → COLORFGBG. Programs (Claude Code, vim, delta, …) that can't
 *  win the OSC-11 background-query round-trip — notably across the wsl.exe hop — fall
 *  back to this env var to pick a light/dark theme. We derive it from our theme's
 *  terminal background so detection is deterministic and synchronous. Pure — tested. */

/** Parse "#rgb" / "#rrggbb" → [r,g,b] 0-255, or null if not a plain hex colour. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Relative luminance (ITU-R BT.709), normalized 0-1 — the same metric Claude Code
 *  uses to classify a background as light (>0.5) or dark. */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** COLORFGBG string for a terminal background hex: light bg → "0;15" (dark fg on light
 *  bg), dark bg → "15;0". Returns null for an unparseable colour so callers leave the
 *  var unset (programs then fall through to their own default). */
export function colorfgbg(bgHex: string): string | null {
  const l = luminance(bgHex)
  if (l === null) return null
  return l > 0.5 ? "0;15" : "15;0"
}
