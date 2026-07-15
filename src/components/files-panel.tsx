import { Fragment, useEffect, useState, type ReactNode } from "react"
import { CaretRight, CaretDown, Folder, File as FileIcon, X } from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { useActiveCwd } from "../lib/use-active-cwd"
import type { DirListing } from "../lib/ipc"

const join = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`)
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p

/** Right-rail lazy file browser rooted at the focused pane's cwd. Reads ONE directory
 *  per expand (never a recursive walk); clicking a file opens it via the OS/editor. */
export function FilesPanel() {
  const cwd = useActiveCwd()
  const [tree, setTree] = useState<Record<string, DirListing>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const close = () => useStore.getState().setFilesPanelOpen(false)

  const load = (dir: string) => {
    void ipc.readdir(dir).then((res) => setTree((t) => ({ ...t, [dir]: res })))
  }

  // Reset + load the root whenever the focused pane's cwd changes.
  useEffect(() => {
    setTree({})
    setExpanded(new Set())
    if (cwd) load(cwd)
  }, [cwd])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        if (!tree[path]) load(path) // lazy: only read a folder the first time it's opened
      }
      return next
    })
  }

  const renderDir = (dir: string, depth: number): ReactNode[] => {
    const listing = tree[dir]
    if (!listing) return []
    const pad = (d: number) => ({ paddingLeft: 8 + d * 14 })
    const rows: ReactNode[] = listing.entries.map((e) => {
      const p = join(dir, e.name)
      if (e.isDir) {
        const open = expanded.has(p)
        return (
          <Fragment key={p}>
            <div className="diff-file file-row" style={pad(depth)} onMouseDown={() => toggle(p)}>
              {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
              <Folder size={14} weight="fill" color="var(--blue)" />
              <span className="tree-primary">{e.name}</span>
            </div>
            {open && renderDir(p, depth + 1)}
          </Fragment>
        )
      }
      return (
        <div
          key={p}
          className="diff-file file-row"
          style={pad(depth)}
          title="Open file"
          onMouseDown={() => cwd && ipc.openFile(cwd, p)}
        >
          <span style={{ width: 12 }} />
          <FileIcon size={14} color="var(--dim)" />
          <span className="tree-primary">{e.name}</span>
        </div>
      )
    })
    if (listing.truncated) {
      rows.push(
        <div
          key={`${dir}:trunc`}
          className="status-faint"
          style={{ ...pad(depth), padding: "2px 10px" }}
        >
          … more (truncated)
        </div>,
      )
    }
    return rows
  }

  return (
    <div className="diffpanel">
      <div className="diffpanel-header">
        <span className="section-label">Files</span>
        <span className="diff-summary status-faint">{cwd ? base(cwd) : "no folder"}</span>
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
        {cwd && renderDir(cwd, 0)}
      </div>
    </div>
  )
}
