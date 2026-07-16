// Pure model for the Files-panel root breadcrumb: split an absolute path into
// clickable cumulative segments, and collapse deep paths to `… › parent › current`.
// No DOM/IPC — unit-tested; the component (root-breadcrumb.tsx) renders these.

export interface Crumb {
  name: string // segment label (root shown as "/" or "C:\")
  path: string // absolute path up to and including this segment
}

// Append backslash-joined segments of `rest` onto a Windows base crumb list.
function winSegments(base: string, rest: string): Crumb[] {
  const crumbs: Crumb[] = [{ name: base, path: base }]
  let acc = base
  for (const seg of rest.split(/[\\/]+/).filter(Boolean)) {
    acc = acc.endsWith("\\") ? acc + seg : `${acc}\\${seg}`
    crumbs.push({ name: seg, path: acc })
  }
  return crumbs
}

/** Split an absolute path into cumulative crumbs, root first. Supports POSIX (`/a/b`),
 *  Windows drive (`C:\a\b` / `C:/a/b`, bare `C:`) and UNC (`\\server\share\a`) roots.
 *  Returns [] for a non-absolute path. */
export function parseBreadcrumb(p: string): Crumb[] {
  const unc = /^\\\\([^\\/]+)\\([^\\/]+)(.*)$/.exec(p) // \\server\share\rest
  if (unc) return winSegments(`\\\\${unc[1]}\\${unc[2]}`, unc[3] ?? "")
  const bareDrive = /^([A-Za-z]:)$/.exec(p) // "C:" with no separator
  if (bareDrive) return [{ name: `${bareDrive[1]}\\`, path: `${bareDrive[1]}\\` }]
  const win = /^[A-Za-z]:[\\/]/.exec(p)
  if (win) return winSegments(`${p.slice(0, 2)}\\`, p.slice(3))
  if (!p.startsWith("/")) return []
  const crumbs: Crumb[] = [{ name: "/", path: "/" }]
  let acc = ""
  for (const seg of p.split("/").filter(Boolean)) {
    acc = `${acc}/${seg}`
    crumbs.push({ name: seg, path: acc })
  }
  return crumbs
}

/** Strip trailing separators so `/a/b/` and `/a/b` key the same tree / don't read as
 *  diverged — while preserving a bare root (`/`, `C:\`). */
export function normalizeRootPath(p: string): string {
  const t = p.trim()
  if (t.startsWith("/")) return t === "/" ? "/" : t.replace(/\/+$/, "")
  const drive = /^[A-Za-z]:/.exec(t)
  if (drive) {
    const stripped = t.replace(/[\\/]+$/, "")
    return stripped.length <= 2 ? `${drive[0]}\\` : stripped // "C:" / "C:\" → "C:\"
  }
  if (t.startsWith("\\\\")) return t.replace(/[\\/]+$/, "") // UNC
  return t
}

export interface CollapsedCrumbs {
  hidden: Crumb[] // leading ancestors folded behind the "…" dropdown
  visible: Crumb[] // trailing crumbs shown inline (always includes the current dir)
}

/** Keep the last `maxVisible` crumbs inline; fold the rest into `hidden` (surfaced via
 *  a "…" dropdown). maxVisible < 1 is treated as 1 so the current dir always shows. */
export function collapseBreadcrumb(crumbs: Crumb[], maxVisible: number): CollapsedCrumbs {
  const keep = Math.max(1, maxVisible)
  if (crumbs.length <= keep) return { hidden: [], visible: crumbs }
  return { hidden: crumbs.slice(0, crumbs.length - keep), visible: crumbs.slice(-keep) }
}
