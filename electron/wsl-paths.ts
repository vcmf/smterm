// Windows reads a WSL distro's files through the \\wsl.localhost\ share, so we translate
// a Linux path (from OSC-7 inside the distro) into that UNC form for host-side fs access
// (the files browser). Pure — unit-tested. Git already runs INSIDE the distro (git.ts),
// so this is only for the plain fs listing.

/** `\\wsl.localhost\<distro>\<path>` for an absolute Linux path, or null when we can't
 *  form one (no distro name, or not an absolute Linux path). */
export function wslToUnc(distro: string | undefined, linuxPath: string): string | null {
  if (!distro || !linuxPath.startsWith("/")) return null
  return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, "\\")}`
}
