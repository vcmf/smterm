import { Menu, type MenuItemConstructorOptions } from "electron"

// Mirrors MenuEditAction in src/lib/ipc.ts — kept local so this (node) module doesn't
// pull the DOM-typed renderer file into the electron tsconfig.
type MenuEditAction = "cut" | "copy" | "paste" | "selectAll"

// macOS only. The default Electron menu's Edit roles (Copy/Paste/Select All) run
// webContents copy/paste, which can't see xterm's selection (WebGL canvas, not a DOM
// selection) — so Cmd+C/V/A look broken in the terminal. Install a menu that keeps the
// standard app/view/window items but routes the Edit clipboard actions to the renderer,
// which does the terminal-aware thing (or the input action when a settings field is
// focused). Other platforms keep the default menu (copy/paste already work there).
export function installAppMenu(send: (action: MenuEditAction) => void): void {
  if (process.platform !== "darwin") return
  const edit = (
    label: string,
    accelerator: string,
    action: MenuEditAction,
  ): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(action) })

  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        edit("Cut", "Cmd+X", "cut"),
        edit("Copy", "Cmd+C", "copy"),
        edit("Paste", "Cmd+V", "paste"),
        edit("Select All", "Cmd+A", "selectAll"),
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
