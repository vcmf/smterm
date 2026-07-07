import { useEffect, useState } from "react"
import { HardDrives, Bell } from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"

const clockNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

/** Bottom status bar: platform · session counts · clock. Git branch is Track B. */
export function StatusBar() {
  const sessions = useStore((s) => s.sessions)
  const [platform, setPlatform] = useState("")
  const [clock, setClock] = useState(clockNow)

  useEffect(() => {
    void ipc.platformInfo().then((info) => setPlatform(info.label))
  }, [])

  useEffect(() => {
    const t = setInterval(() => setClock(clockNow()), 15_000)
    return () => clearInterval(t)
  }, [])

  const all = Object.values(sessions)
  const running = all.filter((s) => s.status === "working").length
  const waiting = all.filter((s) => s.status === "attention").length

  return (
    <div className="statusbar">
      <span className="status-item">
        <HardDrives size={13} />
        {platform}
      </span>
      <div className="status-spacer" />
      <span className="status-item">
        <span className={`dot accent${running ? " pulse" : ""}`} /> {running} running
      </span>
      <span className="status-item">
        <span className="dot amber" /> {waiting} waiting
      </span>
      <span className="status-item" style={{ color: waiting ? "var(--amber)" : undefined }}>
        <Bell size={13} weight={waiting ? "fill" : "regular"} color="currentColor" />
        {waiting}
      </span>
      <span className="status-faint">UTF-8</span>
      <span className="status-faint">{clock}</span>
    </div>
  )
}
