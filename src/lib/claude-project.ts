// Where Claude files a session: ~/.claude/projects/<folder, every non-alphanumeric → "-">/<id>.jsonl.
// `claude --resume <id>` only finds a session from that folder, so a folder that doesn't encode
// to the transcript's project dir can't be the session's (a background agent's scratchpad, a
// nested claude's cwd) — the resume ledger uses this to reject such folders.

/** Claude's project-folder name for a working directory. */
export const claudeProjectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, "-")

// Past this Claude may shorten the name; we can't be sure of the rule, so don't judge.
const MAX_CERTAIN = 200

/** Does `cwd` belong to the session filed at `transcriptPath`? undefined = can't tell. */
export function cwdMatchesTranscript(
  cwd: string | undefined,
  transcriptPath: string | undefined,
): boolean | undefined {
  if (!cwd || !transcriptPath) return undefined
  const parts = transcriptPath.split(/[\\/]/).filter(Boolean)
  const dir = parts[parts.length - 2]
  if (!dir || parts[parts.length - 3] !== "projects") return undefined // not a Claude transcript
  // Strip a trailing separator — but not from a root ("/", "C:\\" → Claude's "C--").
  const bare = /^([A-Za-z]:)?[\\/]$/.test(cwd) ? cwd : cwd.replace(/[\\/]+$/, "")
  const name = claudeProjectDirName(bare)
  if (name.length <= MAX_CERTAIN && dir.length <= MAX_CERTAIN) return name === dir
  // A long name may be shortened by Claude: only a shared start keeps it possible (a long
  // scratchpad path vs a short project folder is still a clear mismatch).
  return dir.startsWith(name.slice(0, 100)) || name.startsWith(dir.slice(0, 100))
    ? undefined
    : false
}
