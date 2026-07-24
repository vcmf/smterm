import { useEffect, useRef, useState } from "react"
import {
  CaretRight,
  DotsThree,
  FolderOpen,
  PencilSimple,
  ArrowCounterClockwise,
} from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { getActiveWsl } from "../lib/use-active-cwd"
import { parseBreadcrumb, collapseBreadcrumb } from "../lib/breadcrumb"
import { isAbsoluteHostPath } from "../lib/file-actions"

const MAX_VISIBLE = 3 // trailing crumbs shown inline; the rest fold into the "…" menu

/** Root navigation bar for the Files panel: a collapsible clickable breadcrumb of the
 *  current root, a "…" dropdown for folded ancestors, browse (native picker) + type-a-path
 *  entry, and an amber reset button when the root has diverged from the terminal cwd. */
export function RootBreadcrumb({
  root,
  cwd,
  sessionId,
  diverged,
}: {
  root: string
  cwd: string | undefined
  sessionId: string | undefined
  diverged: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const setRoot = (p: string) => sessionId && useStore.getState().setPaneRoot(sessionId, p)
  const reset = () => sessionId && useStore.getState().clearPaneRoot(sessionId)

  const beginEdit = () => {
    setValue(root)
    setInvalid(false)
    setEditing(true)
  }
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const applyTyped = async () => {
    const p = value.trim()
    if (p === root) return setEditing(false)
    // Must be an absolute host path (setPaneRoot enforces it too) AND an existing dir —
    // checked via the pane's WSL context so a Linux path validates through the UNC share.
    if (isAbsoluteHostPath(p) && (await ipc.pathIsDir(p, getActiveWsl()))) {
      setRoot(p)
      setEditing(false)
    } else {
      setInvalid(true)
    }
  }
  const browse = async () => {
    const picked = await ipc.pickDirectory(root, getActiveWsl())
    if (picked) setRoot(picked)
  }

  if (editing) {
    return (
      <div className="rootbar">
        <input
          ref={inputRef}
          className={`root-input${invalid ? " invalid" : ""}`}
          value={value}
          spellCheck={false}
          placeholder="Absolute folder path…"
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void applyTyped()
            else if (e.key === "Escape") setEditing(false)
          }}
          onBlur={() => setEditing(false)}
        />
      </div>
    )
  }

  const { hidden, visible } = collapseBreadcrumb(parseBreadcrumb(root), MAX_VISIBLE)

  return (
    <div className="rootbar">
      <div className="crumbs" title={root}>
        {hidden.length > 0 && (
          <span className="crumb-more">
            <button className="crumb" title="Parent folders" onClick={() => setMenuOpen(true)}>
              <DotsThree size={14} weight="bold" />
            </button>
            {menuOpen && (
              <>
                <div className="menu-backdrop" onMouseDown={() => setMenuOpen(false)} />
                <div className="shell-menu crumb-menu">
                  {hidden
                    .slice()
                    .reverse()
                    .map((c) => (
                      <button
                        key={c.path}
                        className="shell-menu-item"
                        onMouseDown={() => {
                          setMenuOpen(false)
                          setRoot(c.path)
                        }}
                      >
                        <span>{c.name}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
            <CaretRight size={11} className="crumb-sep" />
          </span>
        )}
        {visible.map((c, i) => (
          <span key={c.path} className="crumb-seg">
            {i > 0 && <CaretRight size={11} className="crumb-sep" />}
            <button
              className={`crumb${i === visible.length - 1 ? " current" : ""}`}
              onClick={() => setRoot(c.path)}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>
      <div className="rootbar-actions">
        <button className="iconbtn" style={btn} title="Enter a path" onClick={beginEdit}>
          <PencilSimple size={13} />
        </button>
        <button
          className="iconbtn"
          style={btn}
          title="Choose a folder…"
          onClick={() => void browse()}
        >
          <FolderOpen size={13} />
        </button>
        {diverged && (
          <button
            className="iconbtn root-reset"
            style={btn}
            title={`Reset to terminal folder${cwd ? ` (${cwd})` : ""}`}
            onClick={reset}
          >
            <ArrowCounterClockwise size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

const btn = { width: 22, height: 22 }
