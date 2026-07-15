<p align="center">
  <img src="docs/media/icon.png" alt="smterm" width="128" height="128" />
</p>

<h1 align="center">smterm</h1>

<p align="center">A minimal terminal for agentic coding, built to keep you in the loop (yes we love reading the code).</p>

<p align="center">
  <a href="https://github.com/vcmf/smterm/actions/workflows/ci.yml"><img src="https://github.com/vcmf/smterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows%2FWSL-informational" alt="Platforms" />
</p>

It is a fast, normal terminal (tabs, split panes, real shells) with a few things added for
people who run coding agents all day:

- 🔔 **Knows which session needs you.** Working, waiting for input, or done, shown as a dot on
  the tab and in the sidebar, plus a native notification when a background pane wants you. No
  more finding a finished agent an hour late.
- 🔍 **Changes panel.** A git diff for the focused pane's working directory, so you can read
  what an agent just touched. Branch and ahead/behind show in the status bar.
- 📁 **Files browser.** A lazy per-folder listing rooted at the focused pane's cwd, with git
  decorations (badges on changed files, tinted folders). Click a file to open it in your editor.
- 🤖 **Agents board.** A live view of the Claude Code agents you launched inside smterm: the
  root session, its sub-agents, what each is doing, its cwd, and its recent files. Click one to
  jump to its pane.
- 🪟 **Real multiplexer.** Tabs and resizable splits. Split a pane and it keeps your shell and
  directory. Quit and reopen and your layout comes back.
- ⌨️ **Command palette (⌘K).** New sessions, splits, theme switching, settings.
- 🎨 **Themes and fonts.** Minimal Dark, Tokyo Night, Catppuccin, Gruvbox; bundled fonts and
  ligatures.

<!-- TODO: drop a hero screenshot here once one exists, e.g. docs/media/hero.png -->

## Why

Agents write the code now, but you are still the one who reviews it and ships it. So the
terminal should help you read and stay in the loop, not just scroll text past you. That is the
whole point of the Changes, Files, and Agents panels: see what changed, not just that something
did.

## Install

macOS and Linux:

```
curl -fsSL https://raw.githubusercontent.com/vcmf/smterm/main/install.sh | sh
```

Windows (PowerShell):

```
irm https://raw.githubusercontent.com/vcmf/smterm/main/install.ps1 | iex
```

Prefer to click things? Grab a build from the
[releases page](https://github.com/vcmf/smterm/releases). Read the honest bit below first.

### The honest bit about that curl command

Piping a script from the internet straight into your shell is exactly the kind of thing you
should be suspicious of. Good instinct. The script is short and it is [right here](install.sh),
so read it before you run it. All it does is grab the newest release for your OS from GitHub
and put the app in `/Applications` (macOS) or `~/.local/bin` (Linux).

We lead with the curl install on purpose. smterm is not notarized by Apple yet (that costs
money and we are getting to it). If you download the `.dmg` in a browser, macOS will show you a
stern "could not verify this app is free of malware" box and hide the Open button. Files
fetched from the terminal skip that check, so the curl install just works. Once we notarize,
the double-click download will be smooth too. Same story on Windows: the terminal install
avoids the SmartScreen warning a browser download triggers.

If you already downloaded the `.dmg` and macOS is refusing to open it, this clears it:

```
xattr -dr com.apple.quarantine /Applications/smterm.app
```

## Also

Beyond the headline features above:

- macOS, Linux, and Windows, with WSL as a first-class shell target
- Copy and paste, find in scrollback (`Cmd`/`Ctrl+Shift` + `F`)
- Collapsible sidebar and a shell picker for new tabs
- The Agents board needs zero setup: it is wired only for panes smterm spawns

## Configuration

Settings live in a single JSON file that is the source of truth. Edit it by hand or through the
in-app settings panel; a live watcher re-applies changes as you save.

- macOS and Linux: `~/.config/smterm/settings.json`
- Windows: `%APPDATA%\smterm\settings.json`

```jsonc
{
  "font": { "family": "JetBrains Mono", "size": 13, "ligatures": true, "lineHeight": 1.2 },
  "theme": "minimal-dark",
  "cursorBlink": true,
  "scrollback": 5000,
}
```

## What is still rough

This is v0. It is genuinely useful and it will also occasionally surprise you. Honesty beats a
pristine-looking README.

- macOS is Apple Silicon only for now. An Intel build is on the list.
- Nothing is code-signed or notarized yet, so expect a security prompt if you go around the
  installer. This is the next thing on the roadmap.
- The "is this agent actually working or just sitting there" detection is a heuristic. It is
  good, not psychic.
- The Agents board is Claude Code specific right now (it reads Claude's own hook events). Other
  agents will come; the underlying reducer is agent-agnostic.
- Windows and WSL work but have had less real-world mileage than macOS and Linux.
- Live processes do not survive a full quit yet. Your layout comes back, your running programs
  do not.

Found a bug? [Open an issue](https://github.com/vcmf/smterm/issues). A report that says "here
is what I did, here is what happened, here is what I expected" is worth its weight in gold.

## Build from source

```
git clone https://github.com/vcmf/smterm
cd smterm
make install   # deps, native module rebuild, git hooks
make run       # dev mode
make dist      # package an installable build for your OS
```

Run `make help` for the full list of targets (`make check` runs lint + tests, `make fmt`
formats). Logic lives in small pure modules with real tests (`make test`).

Stack, if you care: Electron, React, TypeScript, xterm.js on the WebGL renderer, and node-pty
for the shells. Zustand for state, react-resizable-panels for the layout, Vitest for tests.
Design and decisions live in [`docs/`](docs/): start with
[ARCHITECTURE.md](docs/ARCHITECTURE.md) and [ROADMAP.md](docs/ROADMAP.md).

## License

[MIT](LICENSE). Do what you want with it.
