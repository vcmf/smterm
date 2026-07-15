import { useEffect, useMemo, useRef, useState } from "react"
import { CaretRight, CaretDown, Folder, File as FileIcon, X } from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { useActiveCwd } from "../lib/use-active-cwd"
import {
  FileTreeCache,
  emptyTree,
  setListing,
  toggleDir,
  visibleRows,
  openDirs,
  baseName,
  type FileTreeState,
} from "../lib/file-tree"
import { buildGitDecorations, statusLetter, statusColor } from "../lib/git-decorations"

// Per-cwd LRU cache so re-focusing a pane restores its tree instantly instead of
// re-listing from scratch. Bounded to 16 folders (each listing itself capped by the
// backend → a few-MB ceiling). Module-level so it survives the panel unmounting when
// you switch to another view.
const cache = new FileTreeCache(16)

/** Right-rail lazy file browser rooted at the focused pane's cwd. Reads ONE directory
 *  per expand; caches per cwd (restore on refocus) and background-refreshes for
 *  freshness. All tree/cache logic is the pure, tested `lib/file-tree`. */
export function FilesPanel() {
  const cwd = useActiveCwd()
  const git = useStore((s) => s.git)
  const [tree, setTree] = useState<FileTreeState | null>(null)
  const cwdRef = useRef<string | undefined>(undefined)
  const close = () => useStore.getState().setRightView(null)

  // Git decorations for the current repo (reuses the already-polled store.git; no
  // extra git calls). Files get a status letter + colour, folders get a tinted name.
  const deco = useMemo(() => (git?.isRepo ? buildGitDecorations(git.root, git.files) : null), [git])

  // Apply a state update to a specific cwd's cache entry; mirror to the UI only if
  // that cwd is still active — so a late background readdir for a pane you've since
  // left updates its cache but never flashes into the current view.
  const apply = (key: string, fn: (s: FileTreeState) => FileTreeState) => {
    const next = fn(cache.get(key) ?? emptyTree(key))
    cache.set(key, next)
    if (cwdRef.current === key) setTree(next)
  }
  const load = (key: string, dir: string) => {
    void ipc.readdir(dir).then((listing) => apply(key, (s) => setListing(s, dir, listing)))
  }

  useEffect(() => {
    cwdRef.current = cwd
    if (!cwd) {
      setTree(null)
      return
    }
    const cached = cache.get(cwd)
    if (cached) {
      setTree(cached) // instant restore…
      openDirs(cached).forEach((dir) => load(cwd, dir)) // …then refresh open dirs in the background
    } else {
      const t = emptyTree(cwd)
      cache.set(cwd, t)
      setTree(t)
      load(cwd, cwd) // first visit: read the root
    }
  }, [cwd])

  const toggle = (dir: string) => {
    if (!tree || !cwd) return
    const { state, needsLoad } = toggleDir(tree, dir)
    cache.set(cwd, state)
    setTree(state)
    if (needsLoad) load(cwd, needsLoad)
  }

  const rows = tree ? visibleRows(tree) : []

  return (
    <div className="diffpanel">
      <div className="diffpanel-header">
        <span className="section-label">Files</span>
        <span className="diff-summary status-faint">{cwd ? baseName(cwd) : "no folder"}</span>
        <button className="iconbtn" style={{ width: 22, height: 22 }} title="Close" onClick={close}>
          <X size={13} />
        </button>
      </div>
      <div className="diff-files agents-files">
        {!cwd && (
          <div className="diff-empty status-faint">
            No folder — the focused pane has no cwd yet.
          </div>
        )}
        {rows.map((r) => {
          const pad = { paddingLeft: 8 + r.depth * 14 }
          if (r.kind === "note") {
            return (
              <div key={r.path} className="status-faint" style={{ ...pad, padding: "2px 10px" }}>
                {r.name}
              </div>
            )
          }
          if (r.kind === "dir") {
            const st = deco?.dir.get(r.path)
            return (
              <div
                key={r.path}
                className="diff-file file-row"
                style={pad}
                onMouseDown={() => toggle(r.path)}
              >
                {r.expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                <Folder size={14} weight="fill" color="var(--blue)" />
                <span className="tree-primary" style={st ? { color: statusColor(st) } : undefined}>
                  {r.name}
                </span>
              </div>
            )
          }
          const st = deco?.file.get(r.path)
          const color = st ? statusColor(st) : undefined
          return (
            <div
              key={r.path}
              className="diff-file file-row"
              style={pad}
              title="Open file"
              onMouseDown={() => cwd && ipc.openFile(cwd, r.path)}
            >
              <span style={{ width: 12 }} />
              <FileIcon size={14} color={color ?? "var(--dim)"} />
              <span className="tree-primary" style={color ? { color } : undefined}>
                {r.name}
              </span>
              {st && (
                <span className="git-badge" style={{ color }}>
                  {statusLetter(st)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
