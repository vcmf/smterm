import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

// Shell scripts inlined as line arrays (not template literals: they contain
// ${...} and octal \033 which JS template literals would choke on).

// Disable every mouse-tracking mode (X10/normal/button/any-event + SGR encoding).
// A full-screen TUI (e.g. an agent) that was killed abnormally — the classic case
// is Claude Code dying on lid-close/sleep — never restores these, so afterwards
// each mouse move floods the prompt with raw SGR reports (`35;70;25M…`). Emitting
// this from precmd self-heals the instant control returns to the shell; it's safe
// at a prompt because no full-screen program is running to want the mouse.
const MOUSE_RESET = "\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l"

const ZSH_ZSHENV = [
  "# smterm shell integration — zsh .zshenv (loaded for every zsh invocation).",
  'if [[ -f "${SMTERM_USER_ZDOTDIR:-$HOME}/.zshenv" ]]; then',
  '  source "${SMTERM_USER_ZDOTDIR:-$HOME}/.zshenv"',
  "fi",
  '[[ -n "$SMTERM_ZDOTDIR" ]] && ZDOTDIR="$SMTERM_ZDOTDIR"',
  "",
].join("\n")

export const ZSH_ZSHRC = [
  "# smterm shell integration — zsh .zshrc",
  "# Restore the user's ZDOTDIR and load their real interactive config first.",
  'ZDOTDIR="${SMTERM_USER_ZDOTDIR:-$HOME}"',
  'if [[ -f "$ZDOTDIR/.zshrc" ]]; then',
  '  source "$ZDOTDIR/.zshrc"',
  "fi",
  "",
  "# Emit OSC 133 marks so smterm can track command start/finish.",
  'if [[ -o interactive && -z "$__SMTERM_ZSH_HOOKS" ]]; then',
  "  __SMTERM_ZSH_HOOKS=1",
  "  autoload -Uz add-zsh-hook 2>/dev/null",
  "  __smterm_preexec() { printf '\\033]133;C\\007'; }",
  "  __smterm_precmd() {",
  "    local ret=$?",
  "    printf '\\033]133;D;%s\\007' \"$ret\"",
  '    printf \'\\033]7;file://%s%s\\007\' "${HOST:-localhost}" "$PWD"',
  "    printf '" + MOUSE_RESET + "' # heal a crashed TUI's leftover mouse mode",
  "  }",
  "  add-zsh-hook preexec __smterm_preexec 2>/dev/null",
  "  add-zsh-hook precmd __smterm_precmd 2>/dev/null",
  "fi",
  "",
].join("\n")

const ZSH_ZPROFILE = [
  "# smterm shell integration — zsh .zprofile (login shells)",
  'if [[ -f "${SMTERM_USER_ZDOTDIR:-$HOME}/.zprofile" ]]; then',
  '  source "${SMTERM_USER_ZDOTDIR:-$HOME}/.zprofile"',
  "fi",
  "",
].join("\n")

const ZSH_ZLOGIN = [
  "# smterm shell integration — zsh .zlogin (login shells)",
  'if [[ -f "${SMTERM_USER_ZDOTDIR:-$HOME}/.zlogin" ]]; then',
  '  source "${SMTERM_USER_ZDOTDIR:-$HOME}/.zlogin"',
  "fi",
  "",
].join("\n")

export const BASH_RC = [
  "# smterm shell integration — bash (loaded via bash --rcfile).",
  "if [[ -f /etc/bash.bashrc ]]; then source /etc/bash.bashrc; fi",
  'if [[ -f "$HOME/.bashrc" ]]; then source "$HOME/.bashrc"; fi',
  "",
  "# Only instrument interactive shells, once.",
  'case "$-" in *i*) ;; *) return ;; esac',
  '[[ -n "$__SMTERM_BASH_HOOKS" ]] && return',
  "__SMTERM_BASH_HOOKS=1",
  "",
  "__smterm_armed=0",
  "",
  "__smterm_preexec() {",
  '  [[ "$BASH_COMMAND" == "$PROMPT_COMMAND" ]] && return',
  "  [[ $__smterm_armed == 1 ]] && return",
  "  __smterm_armed=1",
  "  printf '\\033]133;C\\007'",
  "}",
  "",
  "__smterm_precmd() {",
  "  local ret=$?",
  "  printf '\\033]133;D;%s\\007' \"$ret\"",
  '  printf \'\\033]7;file://%s%s\\007\' "${HOSTNAME:-localhost}" "$PWD"',
  "  printf '" + MOUSE_RESET + "' # heal a crashed TUI's leftover mouse mode",
  "  __smterm_armed=0",
  "}",
  "",
  'PROMPT_COMMAND="__smterm_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
  "trap '__smterm_preexec' DEBUG",
  "",
].join("\n")

export interface ShellOption {
  id: string
  label: string
  command: string
  args: string[]
}

export interface Injection {
  env: Record<string, string>
  args: string[]
}

function integrationBase(): string {
  return path.join(os.tmpdir(), "smterm", "shell-integration")
}

function materialize(base: string): void {
  const zsh = path.join(base, "zsh")
  fs.mkdirSync(zsh, { recursive: true })
  fs.writeFileSync(path.join(zsh, ".zshenv"), ZSH_ZSHENV)
  fs.writeFileSync(path.join(zsh, ".zshrc"), ZSH_ZSHRC)
  fs.writeFileSync(path.join(zsh, ".zprofile"), ZSH_ZPROFILE)
  fs.writeFileSync(path.join(zsh, ".zlogin"), ZSH_ZLOGIN)
  const bash = path.join(base, "bash")
  fs.mkdirSync(bash, { recursive: true })
  fs.writeFileSync(path.join(bash, "bashrc"), BASH_RC)
}

/** Env + args to inject OSC 133 shell integration; null if unsupported. */
export function buildInjection(shell: string): Injection | null {
  const name = path.basename(shell)
  let base: string
  try {
    base = integrationBase()
    materialize(base)
  } catch {
    return null // best-effort: fall back to a plain shell
  }
  if (name === "zsh" || name.endsWith("-zsh")) {
    const ours = path.join(base, "zsh")
    const user = process.env.ZDOTDIR ?? os.homedir()
    return {
      env: {
        ZDOTDIR: ours,
        SMTERM_ZDOTDIR: ours,
        SMTERM_USER_ZDOTDIR: user,
        SMTERM_SHELL_INTEGRATION: "1",
      },
      args: [],
    }
  }
  if (name === "bash") {
    return {
      env: { SMTERM_SHELL_INTEGRATION: "1" },
      args: ["--rcfile", path.join(base, "bash", "bashrc")],
    }
  }
  return null
}

/** Parse `wsl.exe -l -q` output (one distro per line). Pure — unit-tested. */
export function parseWslDistros(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter((line) => line.length > 0)
}

function wslDistros(): string[] {
  try {
    // wsl.exe emits UTF-16LE.
    const out = execFileSync("wsl.exe", ["-l", "-q"], { encoding: "utf16le" })
    return parseWslDistros(out)
  } catch {
    return []
  }
}

/** Shells/profiles available on this machine, for the "New" picker. */
export function listShells(): ShellOption[] {
  const out: ShellOption[] = []
  if (process.platform === "win32") {
    out.push({ id: "powershell", label: "PowerShell", command: "powershell.exe", args: [] })
    out.push({ id: "cmd", label: "Command Prompt", command: "cmd.exe", args: [] })
    for (const distro of wslDistros()) {
      out.push({
        id: `wsl:${distro}`,
        label: `WSL: ${distro}`,
        command: "wsl.exe",
        args: ["-d", distro],
      })
    }
  } else {
    const def = process.env.SHELL ?? "/bin/zsh"
    out.push({ id: "default", label: path.basename(def), command: def, args: [] })
    for (const cand of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
      if (fs.existsSync(cand) && !out.some((s) => s.command === cand)) {
        out.push({ id: cand, label: path.basename(cand), command: cand, args: [] })
      }
    }
  }
  return out
}
