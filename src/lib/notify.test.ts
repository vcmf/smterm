import { describe, it, expect, vi, beforeEach } from "vitest"
import { ensureNotificationPermission, notify } from "./notify"
import { ipc } from "./ipc"

beforeEach(() => vi.clearAllMocks())

describe("notify", () => {
  it("ensureNotificationPermission resolves true (main handles it)", async () => {
    await expect(ensureNotificationPermission()).resolves.toBe(true)
  })

  it("notify forwards title/body to the ipc seam", async () => {
    await notify("Done", "31/31 green")
    expect(ipc.notify).toHaveBeenCalledWith("Done", "31/31 green")
  })

  it("swallows ipc errors (best-effort)", async () => {
    vi.mocked(ipc.notify).mockImplementationOnce(() => {
      throw new Error("no notifier")
    })
    await expect(notify("t", "b")).resolves.toBeUndefined()
  })
})
