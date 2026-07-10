// Detecting a WSL session so git runs INSIDE the distro. A WSL shell's cwd (from
// OSC 7) is a Linux path (/home/you/repo) the Windows host can't see, so running
// `git` on the host fails ("not a git repo"). Pure — unit-tested.

export interface WslContext {
  distro?: string // undefined = the default distro
}

const WSL_RE = /(^|[\\/])wsl\.exe$/i

/** WSL context for a session (command + args), or undefined if it isn't a WSL shell. */
export function wslContext(command: string, args: string[]): WslContext | undefined {
  if (!WSL_RE.test(command)) return undefined
  const i = args.findIndex((a) => a === "-d" || a === "--distribution")
  return { distro: i >= 0 ? args[i + 1] : undefined }
}
