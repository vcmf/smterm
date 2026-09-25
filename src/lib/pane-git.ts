// Per-terminal git branch + GitHub PR for the sidebar (cmux-style "PR #51 merged" line).
// Types shared with the main process (electron/pane-git.ts) + pure display helpers.

export type PrState = "open" | "draft" | "merged" | "closed"

export interface PrInfo {
  number: number
  state: PrState
  url: string
}

/** What the sidebar knows about a terminal's repo: its branch and that branch's PR (if any). */
export interface PaneGitInfo {
  branch?: string
  pr?: PrInfo
  prPending?: boolean // the PR is being fetched — ask again shortly
}

/** One terminal to look up: its cwd, and the WSL distro when it's a WSL shell. */
export interface PaneGitRequest {
  paneId: string
  cwd: string
  wsl?: { distro?: string }
}

/** A PR state's label + colour token (theme var name) for the sidebar. */
export function prStateUi(state: PrState): { word: string; color: string } {
  switch (state) {
    case "open":
      return { word: "open", color: "accent" }
    case "draft":
      return { word: "draft", color: "faint" }
    case "merged":
      return { word: "merged", color: "blue" } // themes have no purple token
    default:
      return { word: "closed", color: "red" }
  }
}

/** Claude's last reply as a one-paragraph snippet: markdown noise + whitespace collapsed. */
export function messageSnippet(message: string | undefined): string {
  if (!message) return ""
  return (
    message
      .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
      .replace(/^\s*(#{1,6}|>)\s*/gm, "") // heading / quote markers (line start only: keep "#51")
      .replace(/`+/g, "") // inline-code markers
      .replace(/(\*\*|__)(.+?)\1/g, "$2") // **bold** / __bold__
      // *em* / _em_ only at word edges — keep pane_git.ts, SIDEBAR_WIDTH, a*b intact
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
      .replace(/\s+/g, " ")
      .trim()
  )
}

const sameInfo = (a: PaneGitInfo | undefined, b: PaneGitInfo | undefined): boolean =>
  a?.branch === b?.branch &&
  a?.pr?.number === b?.pr?.number &&
  a?.pr?.state === b?.pr?.state &&
  a?.pr?.url === b?.pr?.url

/** Merge fresh results into the current map; the SAME map when nothing changed (store quiet). */
export function mergePaneGit(
  current: Record<string, PaneGitInfo>,
  fresh: Record<string, PaneGitInfo>,
): Record<string, PaneGitInfo> {
  let next: Record<string, PaneGitInfo> | null = null
  for (const [id, info] of Object.entries(fresh)) {
    if (sameInfo(current[id], info)) continue
    next ??= { ...current }
    next[id] = info
  }
  return next ?? current
}
