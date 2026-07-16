// Pure model for the Files-panel root breadcrumb: split an absolute path into
// clickable cumulative segments, and collapse deep paths to `… › parent › current`.
// No DOM/IPC — unit-tested; the component (root-breadcrumb.tsx) renders these.

export interface Crumb {
  name: string // segment label (root shown as "/" or "C:\")
  path: string // absolute path up to and including this segment
}

/** Split an absolute path into cumulative crumbs, root first. Supports POSIX (`/a/b`)
 *  and Windows drive paths (`C:\a\b` / `C:/a/b`). Returns [] for a non-absolute path. */
export function parseBreadcrumb(p: string): Crumb[] {
  const win = /^[A-Za-z]:[\\/]/.exec(p)
  if (win) {
    const drive = p.slice(0, 2) // "C:"
    const rest = p.slice(3).replace(/[\\/]+$/, "")
    const crumbs: Crumb[] = [{ name: `${drive}\\`, path: `${drive}\\` }]
    let acc = `${drive}\\`
    for (const seg of rest.split(/[\\/]+/).filter(Boolean)) {
      acc = acc.endsWith("\\") ? acc + seg : `${acc}\\${seg}`
      crumbs.push({ name: seg, path: acc })
    }
    return crumbs
  }
  if (!p.startsWith("/")) return []
  const crumbs: Crumb[] = [{ name: "/", path: "/" }]
  let acc = ""
  for (const seg of p.split("/").filter(Boolean)) {
    acc = `${acc}/${seg}`
    crumbs.push({ name: seg, path: acc })
  }
  return crumbs
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
