// App-version comparison + update-check result shape. Pure — tested. Shared by the
// main-process update check (electron/update-check.ts) and the status-bar badge.

export interface UpdateStatus {
  current: string // the running app version
  latest: string | null // newest published version, or null if the check failed
  updateAvailable: boolean
  url: string // release page to open when the user clicks the ping
}

interface Parsed {
  core: [number, number, number]
  pre: string // prerelease tag ("" ⇒ a final release)
}

/** Parse "v1.2.3" / "1.2.3-rc.4" → core + prerelease, or null if not semver-ish. */
function parse(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" }
}

/** Compare prerelease tags per semver: a final release (no tag) outranks any prerelease;
 *  otherwise compare dot-separated identifiers (numeric < alphanumeric, fewer fields lower). */
function comparePre(a: string, b: string): number {
  if (a === b) return 0
  if (a === "") return 1
  if (b === "") return -1
  const as = a.split("."),
    bs = b.split(".")
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i],
      y = bs[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d) return Math.sign(d)
    } else if (xn) return -1
    else if (yn) return 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** -1 / 0 / 1 comparing two versions. Unparseable inputs compare equal (→ no false "update"). */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a),
    pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return comparePre(pa.pre, pb.pre)
}

/** Is `latest` a strictly newer version than `current`? */
export const isNewer = (latest: string, current: string): boolean =>
  compareVersions(latest, current) > 0

/** Fold a fresh check result into the displayed one. A FAILED check (latest === null) is
 *  ignored so a transient offline blip can't clear a real, still-valid update ping; a
 *  successful result always supersedes. */
export const applyUpdateResult = (
  prev: UpdateStatus | null,
  next: UpdateStatus,
): UpdateStatus | null => (next.latest !== null ? next : prev)
