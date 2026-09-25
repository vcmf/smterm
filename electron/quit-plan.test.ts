import { describe, it, expect } from "vitest"
import { quitStep, type QuitState } from "./quit-plan"

const base: QuitState = {
  phase: "running",
  confirmed: false,
  needsConfirm: false,
  livePtys: 2,
  osEnding: false,
}
const step = (o: Partial<QuitState>) => quitStep({ ...base, ...o })

describe("quitStep", () => {
  it("live PTYs → drain first; nothing alive → quit right away", () => {
    expect(step({})).toBe("drain")
    expect(step({ livePtys: 0 })).toBe("proceed")
  })
  it("asks first when the confirm dialog applies; a confirmed quit drains", () => {
    expect(step({ needsConfirm: true })).toBe("confirm")
    expect(step({ needsConfirm: true, confirmed: true })).toBe("drain")
  })
  it("while draining: hold (no dialog, no second drain); once drained: proceed", () => {
    expect(step({ phase: "draining", needsConfirm: true })).toBe("hold")
    expect(step({ phase: "drained", livePtys: 3 })).toBe("proceed")
  })
  it("an OS logout/restart isn't held (macOS would report it cancelled)", () => {
    expect(step({ osEnding: true })).toBe("killNow")
    expect(step({ osEnding: true, livePtys: 0 })).toBe("proceed")
  })
})
