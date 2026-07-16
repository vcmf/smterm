import { useState, type MouseEvent, type ReactNode } from "react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { ContextMenu } from "./context-menu"
import { fileMenuItems, revealLabel, type FileActionId } from "../lib/file-actions"

// The row a menu was opened on. `abs` is the absolute host path (for reveal/open/copy),
// `rel` the path shown relative to the panel root (for "Copy relative path").
export interface FileTarget {
  abs: string
  rel: string
  isDir: boolean
}

interface MenuState extends FileTarget {
  x: number
  y: number
}

/** Shared file/folder right-click menu for the files + changes panels: one hook holds
 *  the open menu, builds items from the current editor/platform, and dispatches each
 *  action to the IPC seam. Returns the menu node to render and an onContextMenu opener. */
export function useFileMenu(): {
  menu: ReactNode
  openFileMenu: (e: MouseEvent, target: FileTarget) => void
} {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const platform = useStore((s) => s.platform)
  const editor = useStore((s) => s.editor)

  const openFileMenu = (e: MouseEvent, target: FileTarget) => {
    e.preventDefault()
    setMenu({ ...target, x: e.clientX, y: e.clientY })
  }

  const dispatch = (id: FileActionId) => {
    if (!menu) return
    if (id === "open") ipc.openFile("", menu.abs)
    else if (id === "reveal") ipc.revealPath(menu.abs)
    else if (id === "copyPath") ipc.clipboardWrite(menu.abs)
    else if (id === "copyRel") ipc.clipboardWrite(menu.rel)
  }

  const node = menu ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={fileMenuItems({
        isDir: menu.isDir,
        editorName: editor?.name ?? "",
        editorAvailable: editor?.available ?? false,
        revealLabel: revealLabel(platform),
      })}
      onSelect={dispatch}
      onClose={() => setMenu(null)}
    />
  ) : null

  return { menu: node, openFileMenu }
}
