import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  MagnifyingGlass,
  Plus,
  Columns,
  Rows,
  SquaresFour,
  Palette,
  GearSix,
  FileText,
  X,
} from "@phosphor-icons/react"
import { useStore } from "../store"
import { THEMES } from "../settings/themes"
import { openSettingsFile, saveSettings } from "../settings/io"

interface Command {
  group: string
  label: string
  sub?: string
  icon: ReactNode
  run: () => void
}

/** ⌘K command palette — spawn/split/switch/theme/settings over real state. */
export function CommandPalette() {
  const shells = useStore((s) => s.shells)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const settings = useStore((s) => s.settings)
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = () => useStore.getState().setPaletteOpen(false)

  const commands = useMemo<Command[]>(() => {
    const store = useStore.getState()
    const shell = shells[0]
    const list: Command[] = []

    if (shell) {
      list.push({
        group: "Session",
        label: "New session",
        sub: shell.label,
        icon: <Plus size={16} />,
        run: () => store.newTab(shell),
      })
      for (const sh of shells.slice(1)) {
        list.push({
          group: "Session",
          label: "New session",
          sub: sh.label,
          icon: <Plus size={16} />,
          run: () => store.newTab(sh),
        })
      }
      list.push(
        {
          group: "Session",
          label: "Split pane right",
          icon: <Columns size={16} />,
          run: () => store.splitActive("row", shell),
        },
        {
          group: "Session",
          label: "Split pane down",
          icon: <Rows size={16} />,
          run: () => store.splitActive("column", shell),
        },
      )
    }

    for (const tab of tabs) {
      if (tab.id === activeTabId) continue
      list.push({
        group: "Navigate",
        label: "Switch session",
        sub: tab.title,
        icon: <SquaresFour size={16} />,
        run: () => store.setActiveTab(tab.id),
      })
    }

    for (const [key, theme] of Object.entries(THEMES)) {
      if (key === settings.theme) continue
      list.push({
        group: "Appearance",
        label: "Theme",
        sub: theme.label,
        icon: <Palette size={16} />,
        run: () => {
          const next = { ...settings, theme: key }
          store.setSettings(next)
          void saveSettings(next)
        },
      })
    }

    list.push(
      {
        group: "App",
        label: "Open settings",
        icon: <GearSix size={16} />,
        run: () => store.setSettingsOpen(true),
      },
      {
        group: "App",
        label: "Edit settings.json",
        icon: <FileText size={16} />,
        run: () => void openSettingsFile(settings),
      },
    )
    return list
  }, [shells, tabs, activeTabId, settings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => `${c.group} ${c.label} ${c.sub ?? ""}`.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => setSel(0), [query])
  useEffect(() => inputRef.current?.focus(), [])

  const runAt = (i: number) => {
    const cmd = filtered[i]
    if (!cmd) return
    close()
    cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      runAt(sel)
    } else if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  }

  // Render items with group headers, tracking a flat index for selection.
  let idx = -1
  let lastGroup = ""

  return (
    <div className="palette-overlay" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <MagnifyingGlass size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Run a command, spawn a session, switch tab…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results">
          {filtered.length === 0 && (
            <div className="palette-item" style={{ color: "var(--faint)" }}>
              <X size={16} /> No matching commands
            </div>
          )}
          {filtered.map((cmd) => {
            idx += 1
            const i = idx
            const header = cmd.group !== lastGroup ? cmd.group : null
            lastGroup = cmd.group
            return (
              <div key={i}>
                {header && <div className="palette-group">{header}</div>}
                <div
                  className={`palette-item${i === sel ? " selected" : ""}`}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={() => runAt(i)}
                >
                  {cmd.icon}
                  <span>{cmd.label}</span>
                  {cmd.sub && <span className="sub">· {cmd.sub}</span>}
                  {i === sel && <span className="palette-enter">⏎</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
