import { describe, it, expect } from "vitest"
import { formatDiagLine } from "./diagnostics"

describe("formatDiagLine", () => {
  it("joins fields as key=value after the timestamp + event", () => {
    expect(formatDiagLine("2026-07-08T20:00:00.000Z", "pty-spawn", { id: "a1", pid: 42 })).toBe(
      "2026-07-08T20:00:00.000Z pty-spawn id=a1 pid=42",
    )
  })

  it("omits the trailing space when there are no fields", () => {
    expect(formatDiagLine("2026-07-08T20:00:00.000Z", "boot")).toBe("2026-07-08T20:00:00.000Z boot")
  })

  it("renders booleans (e.g. quitConfirmed flags)", () => {
    expect(formatDiagLine("2026-07-08T20:00:00.000Z", "before-quit", { confirmed: false })).toBe(
      "2026-07-08T20:00:00.000Z before-quit confirmed=false",
    )
  })
})
