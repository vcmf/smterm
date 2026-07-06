# smterm — Quality: Linting & Testing Strategy

> Why this matters more here than in a typical app: a terminal app is **OS-specific**
> (four targets from one codebase), **concurrency-heavy** (reader threads + mutexes), and
> full of **silent edge cases** — UTF-8 split across read boundaries, resize races, orphaned
> child processes, malformed escape sequences. These fail quietly and only on some platforms.
> Rigor up front is cheaper than debugging a flaky PTY on someone else's Windows box.

The **"Now" tier is wired up** (Makefile, lint gates, Rust unit + PTY integration tests, Vitest
harness, lefthook, CI). Later tiers (component/E2E tests, coverage thresholds, audits) are
introduced per the **Adoption plan** (§8) as features land.

---

## 1. The three test surfaces

The app has three distinct layers, each with its own tooling:

```
        ┌─────────────────────────────────────────────┐
  E2E   │  Drive the real app (tauri-driver, Linux CI) │   few, slow, smoke-level
        ├─────────────────────────────────────────────┤
  Integ │  PTY bridge vs a REAL shell (cargo test)     │   moderate — the riskiest code
        │  Components w/ mocked IPC (Vitest + RTL)      │
        ├─────────────────────────────────────────────┤
  Unit  │  Pure logic: store, parsers (TS + Rust)      │   many, fast, deterministic
        └─────────────────────────────────────────────┘
```

**Weighting for this project:** heavy on the bottom two. Push logic into pure, testable units
(pane-tree ops, OSC parsing, shell resolution) and test them exhaustively. The PTY bridge gets
real-shell integration tests because it's the highest-risk code. E2E stays a thin smoke layer
(and is limited on macOS — see §5).

---

## 2. Linting & static analysis

### Rust (`src-tauri/`)

| Tool                       | Command                                     | Gate                                         |
| -------------------------- | ------------------------------------------- | -------------------------------------------- |
| Formatter                  | `cargo fmt --check`                         | CI fails on diff                             |
| Linter                     | `cargo clippy --all-targets -- -D warnings` | **warnings = errors**                        |
| Dep audit (vulns)          | `cargo audit`                               | CI job (non-blocking → blocking once stable) |
| Dep policy (licenses/bans) | `cargo deny check`                          | optional, recommended                        |

Add `rustfmt.toml` (even empty, to pin style) and `deny.toml`. Clippy with `-D warnings` is the
single highest-value lint gate — it's the compiler feedback loop turned into CI policy.

### TypeScript / React (`src/`)

| Tool       | Command                                                   | Gate              |
| ---------- | --------------------------------------------------------- | ----------------- |
| Type check | `tsc --noEmit`                                            | CI fails on error |
| Linter     | `eslint .` (flat config, typescript-eslint + react-hooks) | CI fails          |
| Formatter  | `prettier --check .`                                      | CI fails on diff  |

`tsconfig.json` should be **strict** (`strict: true`, `noUncheckedIndexedAccess: true`) — the
type system is free bug-catching. Add `eslint-plugin-react-hooks` (catches the exact effect/deps
bugs that would double-spawn PTYs) and `eslint-plugin-react-refresh`.

### One command to run it all

A **`Makefile`** is the single entry point so the same commands work locally and in CI:

```
make lint    # cargo fmt --check, clippy -D warnings, tsc, eslint, prettier --check
make test    # cargo test + vitest
make check   # lint + test (the pre-merge gate — "do all")
make run     # launch the app in dev mode
make ci      # check + build frontend
```

Run `make help` to list every target.

### Pre-commit hooks (recommend **lefthook**)

A single fast binary that handles a polyglot (Rust + JS) repo cleanly:

- **pre-commit:** `cargo fmt` + `clippy` on staged Rust; `eslint --fix` + `prettier` on staged TS.
- **pre-push:** run the fast test suites.

lefthook > husky+lint-staged here because it natively spans Rust and JS without Node-only glue.

---

## 3. Rust backend tests (the PTY bridge — highest priority)

Two kinds:

### 3a. Pure unit tests (in-module `#[cfg(test)]`)

- `default_shell()` resolution per `cfg!(target_os)`.
- `wsl.exe -l -q` output parsing → distro list (feed captured fixture strings).
- Any escape-sequence parsing done in Rust.

### 3b. Integration tests (`src-tauri/tests/pty.rs`) — against a REAL shell

This is where terminal apps earn their reliability. Spawn an actual PTY and assert behavior.
Use a portable command per OS (`sh -c 'echo hi'` on unix, `cmd /c echo hi` on Windows).

**Edge-case catalog (the gold list — implement as the bridge grows):**

| Test                                                        | What it guards           |
| ----------------------------------------------------------- | ------------------------ |
| spawn + read simple output                                  | basic happy path         |
| write input → read echo                                     | input path correctness   |
| resize → child sees new size (`stty size` / `tput cols`)    | resize plumbing          |
| multi-byte UTF-8 across chunk boundary not corrupted        | the classic terminal bug |
| `exit` in shell → reader gets EOF (thread ends)             | lifecycle / no hang      |
| `pty_kill` → child process actually gone (no zombie/orphan) | **process leak**         |
| rapid spawn/kill loop ×100                                  | races, panics, fd leaks  |
| large output burst (dump a big file) → no loss/hang         | backpressure             |
| two sessions → writing A never reaches B                    | session isolation        |

### 3c. Tauri command-layer tests

Use `tauri::test` (`mock_builder`, `MockRuntime`, `tauri::test::get_ipc_response`) to invoke
`pty_spawn`/etc. through the command layer with managed state, no real window. Confirms
serialization, state management, and error mapping.

---

## 4. Frontend tests (Vitest + React Testing Library)

Runner: **Vitest** (native Vite integration, fast). Mock Tauri via `@tauri-apps/api/mocks`
(`mockIPC`, `clearMocks`) so no backend is needed.

### 4a. Pure logic (test exhaustively — cheap, high value)

- **Session store / pane tree:** split (H/V), close-and-collapse, resize distribution, insert,
  find-by-id, active-pane movement. This is reducer-like logic where off-by-one bugs live.
- **OSC parsers (M2):** OSC 9 message extraction; OSC 133 prompt marks; **partial/malformed**
  sequences must not throw or corrupt state.
- **Status state machine (M2):** `working → waiting → done` transitions from input signals.

### 4b. Component tests

- Tab bar: create/close/rename/reorder updates store correctly.
- Pane layout: a split renders two `<TerminalPane>`s; closing collapses correctly.
- `<TerminalPane>`: mounts xterm, calls `pty_spawn` with right args (mocked), wires `onData`,
  disposes + `pty_kill` on unmount. (Mock xterm or run in jsdom with a stub.)
- Link click → `openUrl` called with the URL (mocked opener).

> Note: xterm.js rendering needs a DOM; jsdom covers logic but not real glyph rendering — that's
> what E2E is for. Test _wiring_ here, _behavior_ in E2E.

---

## 5. End-to-end tests (smoke layer)

**Tool:** `tauri-driver` + WebdriverIO (Tauri's official E2E path).

**Important platform caveat:** WebDriver works on **Linux (WebKitWebDriver)** and **Windows
(Edge WebDriver)**, but **macOS WKWebView has no WebDriver support** — so E2E runs in **CI on
Linux** (and optionally Windows), not on the Mac dev machine. Plan accordingly: don't rely on
E2E for the dev inner loop; it's a CI gate.

**Scenarios (keep few, high-signal):**

- App launches; a terminal renders; typing `echo e2e-ok` shows `e2e-ok`.
- Open a new tab / split → correct number of terminals present.
- Resize window → terminal reflows (assert cols change).
- (M2) trigger OSC 9 in shell → notification path invoked (mock the OS toast).

Because E2E is limited/flaky, **it does not replace** the Rust integration tests — those remain
the real guarantee that the terminal core works on each OS.

---

## 6. CI structure (GitHub Actions)

Matrix across `{ubuntu, macos, windows}`. Suggested jobs:

| Job             | Runs on                 | Contents                                                                                 |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `lint`          | ubuntu                  | fmt --check, clippy -D warnings, tsc, eslint, prettier                                   |
| `test-rust`     | **all 3 OSes**          | `cargo test` incl. PTY integration tests (real shells differ per OS — this is the point) |
| `test-frontend` | ubuntu                  | `vitest run` + coverage                                                                  |
| `e2e`           | ubuntu (+windows later) | tauri-driver smoke suite                                                                 |
| `build`         | all 3 OSes              | `tauri build` — catches bundling/config breakage early                                   |
| `audit`         | ubuntu                  | `cargo audit`, `npm audit --production`                                                  |

Cache cargo registry + `target/` and `node_modules` (build times are the main CI cost — first
Tauri build was ~50s cold). Run `test-rust` on all three OSes specifically because PTY behavior
is where cross-platform bugs hide.

---

## 7. Coverage

- **Rust:** `cargo llvm-cov` (or tarpaulin). Enforce a threshold on **logic modules**
  (parsing, shell resolution) — not on the thin Tauri wiring.
- **TS:** Vitest `--coverage` (v8). Enforce a threshold on the **store + parsers**, not UI glue.

Coverage is a floor, not a goal: 100% on the pane-tree logic and OSC parsers matters far more
than a global percentage. Chase the edge-case catalog (§3b), not the number.

---

## 8. Adoption plan (introduce incrementally, starting now)

Cheap to add while the code is small; painful to retrofit later.

| When                     | Add                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Now (before M1 code)** | `rustfmt.toml`, clippy `-D warnings` in a basic CI; strict `tsconfig`; ESLint + Prettier; `Makefile`; lefthook pre-commit. **Plus the first PTY integration test** for the M0 bridge (spawn+echo+kill) — lock in the core before building on it. |
| **During M1**            | Vitest + store unit tests (pane tree is pure logic — test hard); component tests for tabs/splits; expand PTY edge-case catalog (resize, UTF-8, isolation).                                                                                       |
| **During M2**            | OSC parser unit tests (incl. malformed input); status state-machine tests; notification wiring tests.                                                                                                                                            |
| **Before M4**            | E2E smoke via tauri-driver in CI; `build` job on all OSes; coverage thresholds; `cargo audit`/`npm audit`.                                                                                                                                       |

---

## 9. Proposed files to add (when we wire this up)

```
Makefile                      # make lint / test / check / run / ci
lefthook.yml                  # pre-commit / pre-push hooks
.github/workflows/ci.yml      # matrix: lint, test-rust, test-frontend, e2e, build, audit
eslint.config.js              # flat config: typescript-eslint + react-hooks
.prettierrc
src-tauri/rustfmt.toml
src-tauri/deny.toml            # cargo-deny policy (optional)
src-tauri/tests/pty.rs         # PTY bridge integration tests (real shell)
src/**/*.test.ts(x)            # Vitest unit + component tests
e2e/                           # tauri-driver + WebdriverIO specs (M4)
vitest.config.ts
```
