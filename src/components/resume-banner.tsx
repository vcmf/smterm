import { useState } from "react"
import { ArrowCounterClockwise, Check, Warning } from "@phosphor-icons/react"
import { useStore } from "../store"
import { ipc } from "../lib/ipc"
import { isPosixShell, sessionLabel, withCd } from "../lib/resume"
import { TerminalManager } from "../terminal/terminal-manager"

/** A slim strip above a restored terminal saying what happened to the Claude session it was
 *  in: resuming → resumed, or why not, with the next steps. Static — no animation over the
 *  WebGL canvas. */
export function ResumeBanner({ sessionId }: { sessionId: string }) {
  const r = useStore((s) => s.resume[sessionId])
  // A program is in the foreground (OSC 133 C..D) — typing now would go INTO it (a running
  // claude, vim…), so the buttons that type wait until the shell is back at its prompt.
  const busy = useStore((s) => !!s.sessions[sessionId]?.running)
  const [waiting, setWaiting] = useState(false) // a click came before the shell's prompt
  if (!r) return null
  const label = sessionLabel(r.plan)
  // Claude's picker lists the CURRENT project's sessions — the one this banner is about lives
  // in plan.cwd, which (ask mode / WSL) may not be the shell's cwd.
  const shell = useStore.getState().sessions[sessionId]?.command ?? ""
  const pickCommand = isPosixShell(shell)
    ? withCd(r.plan.cwd, "claude --resume")
    : "claude --resume"

  const close = () => {
    TerminalManager.resumeSettled(sessionId)
    useStore.getState().setResume(sessionId, null)
    requestAnimationFrame(() => TerminalManager.focus(sessionId))
  }
  const dismiss = () => {
    ipc.resumeConsume(sessionId, r.plan.sessionId) // don't offer it again on the next launch
    close()
  }
  const run = (command: string) => {
    if (TerminalManager.runCommand(sessionId, command)) close()
    else {
      // Refused until the shell shows its prompt — say so rather than looking broken.
      setWaiting(true)
      setTimeout(() => setWaiting(false), 2500)
    }
  }
  const retry = () => {
    // Refused until the shell shows its prompt (its rc may still be running) — say so.
    if (!TerminalManager.resumeNow(sessionId)) {
      setWaiting(true)
      setTimeout(() => setWaiting(false), 2500)
      return
    }
    requestAnimationFrame(() => TerminalManager.focus(sessionId))
  }
  // Buttons act on this pane; keep the pane's own mousedown (focus) from interfering. The
  // ones that type are disabled while a program runs in the foreground.
  const btn = (text: string, onClick: () => void, primary = false, types = true) => (
    <button
      className={`resume-btn${primary ? " primary" : ""}`}
      disabled={types && busy}
      title={types && busy ? "Exit the running program first" : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {text}
    </button>
  )

  switch (r.phase) {
    case "pending":
    case "resuming":
      return (
        <div className="resume-banner" role="status">
          <ArrowCounterClockwise size={13} />
          <span>
            Resuming Claude session <b>{label}</b>…
          </span>
        </div>
      )
    case "resumed":
      return (
        <div className="resume-banner ok" role="status">
          <Check size={13} weight="bold" />
          <span>
            Resumed <b>{label}</b>
          </span>
        </div>
      )
    case "sent":
      return (
        <div className="resume-banner" role="status">
          <ArrowCounterClockwise size={13} />
          <span>
            Sent <b>claude --resume</b> for <b>{label}</b> — this shell can&apos;t confirm it.
          </span>
          <span className="resume-actions">{btn("Dismiss", close, false, false)}</span>
        </div>
      )
    case "offer":
      return (
        <div className="resume-banner" role="status">
          <ArrowCounterClockwise size={13} />
          <span>
            This pane was in Claude session <b>{label}</b>.
          </span>
          <span className="resume-actions">
            {btn(waiting ? "Waiting for the prompt…" : "Resume", retry, true)}
            {btn("Dismiss", dismiss, false, false)}
          </span>
        </div>
      )
    case "failed":
      return (
        <div className="resume-banner warn" role="alert">
          <Warning size={13} weight="fill" />
          <span>
            Couldn&apos;t resume <b>{label}</b>
            {r.exitCode !== undefined ? ` (claude exited ${r.exitCode})` : ""}.
          </span>
          <span className="resume-actions">
            {btn(waiting ? "Waiting for the prompt…" : "Retry", retry, true)}
            {btn(waiting ? "Waiting for the prompt…" : "Pick a session…", () => run(pickCommand))}
            {btn("Dismiss", dismiss, false, false)}
          </span>
        </div>
      )
    case "skipped":
      return (
        <div className="resume-banner warn" role="alert">
          <Warning size={13} weight="fill" />
          <span>
            Couldn&apos;t resume <b>{label}</b>: {r.plan.reason ?? "it can't be found"}.
          </span>
          <span className="resume-actions">
            {btn(
              waiting ? "Waiting for the prompt…" : "Start Claude here",
              () => run("claude"),
              true,
            )}
            {btn("Dismiss", dismiss, false, false)}
          </span>
        </div>
      )
  }
}
