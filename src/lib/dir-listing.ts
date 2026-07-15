// Pure directory-listing logic for the files browser: filter noise, sort (dirs
// first, then alphabetical), and cap so a huge directory can't flood the renderer.
// Lives here (no DOM, no IPC) so the main-process readdir handler stays a thin shell
// and this — the risky comparator + off-by-one-prone cap — is unit-tested.

export interface DirEntry {
  name: string
  isDir: boolean
}

export interface DirListing {
  entries: DirEntry[] // dirs first, then alphabetical
  truncated: boolean // more entries existed than the cap (surfaced, not hidden)
}

export const READDIR_CAP = 500

/** Filter `.git`, sort (dirs first, then name), and cap. Pure. */
export function toDirListing(entries: DirEntry[], cap: number = READDIR_CAP): DirListing {
  const filtered = entries
    .filter((e) => e.name !== ".git")
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { entries: filtered.slice(0, cap), truncated: filtered.length > cap }
}
