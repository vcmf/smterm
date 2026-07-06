export interface Settings {
  font: {
    family: string;
    size: number;
    ligatures: boolean;
    lineHeight: number;
  };
  theme: string;
  cursorBlink: boolean;
  scrollback: number;
}

export const defaultSettings: Settings = {
  font: { family: "JetBrains Mono", size: 13, ligatures: true, lineHeight: 1.2 },
  theme: "dark",
  cursorBlink: true,
  scrollback: 5000,
};

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim().length > 0 ? v : fallback;

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Deep-merge arbitrary input over defaults, validating + clamping. Unknown keys ignored. */
export function mergeSettings(input: unknown): Settings {
  const o = asObject(input);
  const f = asObject(o.font);
  const d = defaultSettings;
  return {
    font: {
      family: str(f.family, d.font.family),
      size: num(f.size, d.font.size, 6, 72),
      ligatures: bool(f.ligatures, d.font.ligatures),
      lineHeight: num(f.lineHeight, d.font.lineHeight, 1, 3),
    },
    theme: str(o.theme, d.theme),
    cursorBlink: bool(o.cursorBlink, d.cursorBlink),
    scrollback: num(o.scrollback, d.scrollback, 0, 1_000_000),
  };
}

/** Tolerant parse of the raw settings file: bad/empty JSON → defaults, never throws. */
export function parseSettings(raw: string): Settings {
  if (!raw.trim()) return defaultSettings;
  try {
    return mergeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings;
  }
}

export function serializeSettings(s: Settings): string {
  return `${JSON.stringify(s, null, 2)}\n`;
}
