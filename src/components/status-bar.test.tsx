import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { StatusBar } from "./status-bar"
import { ipc } from "../lib/ipc"
import { resetStore } from "../test/helpers"

describe("StatusBar version badge", () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(ipc.appVersion).mockResolvedValue("0.1.24")
  })

  it("shows the app version, dim, when up to date", async () => {
    vi.mocked(ipc.checkUpdate).mockResolvedValue({
      current: "0.1.24",
      latest: "0.1.24",
      updateAvailable: false,
      url: "",
    })
    const { container } = render(<StatusBar />)
    expect(await screen.findByText("smterm 0.1.24")).toBeInTheDocument()
    expect(container.querySelector(".sb-version.update")).toBeNull() // no ping
  })

  it("pings and links to the release when an update is available", async () => {
    vi.mocked(ipc.checkUpdate).mockResolvedValue({
      current: "0.1.24",
      latest: "0.1.25",
      updateAvailable: true,
      url: "https://github.com/vcmf/smterm/releases/latest",
    })
    render(<StatusBar />)
    const badge = await screen.findByRole("button", { name: /v0\.1\.25/ })
    expect(badge).toHaveAttribute("title", expect.stringContaining("Update available — v0.1.25"))
    expect(badge).toHaveTextContent("v0.1.25")
    expect(badge.querySelector(".dot.pulse")).not.toBeNull() // the animated ping
    fireEvent.click(badge)
    expect(ipc.openExternal).toHaveBeenCalledWith("https://github.com/vcmf/smterm/releases/latest")
  })

  it("stays silent if the check fails (latest null)", async () => {
    vi.mocked(ipc.checkUpdate).mockResolvedValue({
      current: "0.1.24",
      latest: null,
      updateAvailable: false,
      url: "",
    })
    const { container } = render(<StatusBar />)
    await waitFor(() => expect(screen.getByText("smterm 0.1.24")).toBeInTheDocument())
    expect(container.querySelector(".sb-version.update")).toBeNull()
  })
})
