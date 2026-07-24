// Windows reads a WSL distro's files through a UNC share, so we translate a Linux path
// (from OSC-7 inside the distro) into that form for host-side fs access (the files
// browser). Pure — unit-tested. Git already runs INSIDE the distro (git.ts), so this is
// only for the plain fs listing.

// Share prefixes, newest first: \\wsl.localhost\ (Win11 / recent WSL), then the legacy
// \\wsl$\ (older Win10). The caller tries them in order — most systems expose both.
export const WSL_UNC_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"] as const

/** Candidate `\\<share>\<distro>\<path>` UNC paths for an absolute Linux path, in
 *  preference order. Empty when we can't form one (no distro name, or not an absolute
 *  Linux path). Only `/` is translated — a literal `\` in a Linux filename isn't
 *  representable over the Windows share (a limitation of the bridge, not this code). */
export function wslUncCandidates(distro: string | undefined, linuxPath: string): string[] {
  if (!distro || !linuxPath.startsWith("/")) return []
  const tail = linuxPath.replace(/\//g, "\\")
  return WSL_UNC_PREFIXES.map((prefix) => `${prefix}${distro}${tail}`)
}

/** `/mnt/<drive>/<path>` for a Windows drive path, so a process INSIDE WSL can reach a
 *  file on a Windows drive (the hook-events dir under %APPDATA%). null if not a drive path. */
export function winToMnt(windowsPath: string): string | null {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath)
  if (!m) return null
  return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, "/")}`
}
