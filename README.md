# smterm

A terminal for the age of coding agents, built for the human who still has to babysit them.

You know the situation. Four agents running in four panes. One is asking for permission,
one finished ten minutes ago and you didn't notice, one is quietly rewriting files you
haven't looked at yet, and one is stuck in a loop. A normal terminal treats all four the
same way: a wall of text scrolling past. smterm doesn't.

## The idea

Agents write the code now. But you are still the person who has to understand it, review
it, and take the blame when it ships. So the terminal should help you read and stay in
control, not just watch text fly by.

smterm is a fast, normal terminal (tabs, split panes, real shells) with a few opinions
bolted on for people who run coding agents all day:

- **It tells you which session needs you.** Working, waiting for input, or done, shown as
  a dot on the tab and in the sidebar, plus a native notification when something in a
  background pane wants your attention. No more discovering a finished agent an hour late.
- **It helps you read the diff.** A built-in git changes panel follows the working
  directory of whatever pane you're in, so you can actually see the files an agent just
  touched instead of trusting the vibes.
- **It is a real multiplexer.** Tabs and resizable splits. Split a pane and it keeps your
  shell and your directory. Quit and reopen and your layout comes back.

Humans at the heart, agents doing the typing.

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

Piping a script from the internet straight into your shell is exactly the kind of thing
you should be suspicious of. Good instinct. The script is short and it is
[right here](install.sh), so read it before you run it. All it does is grab the newest
release for your OS from GitHub and put the app in `/Applications` (macOS) or
`~/.local/bin` (Linux).

We lead with the curl install on purpose. smterm is not notarized by Apple yet (that
costs money and we are getting to it). If you download the `.dmg` in a browser, macOS
will show you a stern "could not verify this app is free of malware" box and hide the
Open button. Files fetched from the terminal skip that check, so the curl install just
works. Once we notarize, the double-click download will be smooth too. Same story on
Windows: the terminal install avoids the SmartScreen warning a browser download triggers.

If you already downloaded the `.dmg` and macOS is refusing to open it, this clears it:

```
xattr -dr com.apple.quarantine /Applications/smterm.app
```

## What works today

- Tabs and split panes, resizable, with cwd inheritance when you split
- macOS, Linux, and Windows, with WSL as a first-class shell target
- Agent-aware status and native notifications when a background session needs you
- A git diff panel that tracks your focused pane's directory
- Copy and paste, find in scrollback (`Cmd`/`Ctrl+Shift` + `F`), themes, fonts, ligatures
- Collapsible sidebar and a shell picker for new tabs
- Your tab and pane layout is saved and restored on the next launch

## What is still rough

This is v0. It is genuinely useful and it will also occasionally surprise you. Honesty
beats a pristine-looking README:

- macOS is Apple Silicon only for now. An Intel build is on the list.
- Nothing is code-signed or notarized yet, so expect a security prompt if you go around
  the installer. This is the next thing on the roadmap.
- The "is this agent actually working or just sitting there" detection is a heuristic. It
  is good, not psychic.
- Windows and WSL work but have had less real-world mileage than macOS and Linux.
- Live processes do not survive a full quit yet. Your layout comes back, your running
  programs do not.

Found a bug? [Open an issue](https://github.com/vcmf/smterm/issues). A report that says
"here is what I did, here is what happened, here is what I expected" is worth its weight
in gold.

## Build from source

```
git clone https://github.com/vcmf/smterm
cd smterm
make install   # deps, native module rebuild, git hooks
make run       # dev mode
make dist      # package an installable build for your OS
```

Stack, if you care: Electron, React, TypeScript, xterm.js on the WebGL renderer, and
node-pty for the shells. Logic lives in small pure modules with real tests (`make test`).

## License

[MIT](LICENSE). Do what you want with it.
