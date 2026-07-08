# smterm — Performance & Load Testing

Companion to [ROADMAP.md](./ROADMAP.md) M3.6 Track B. This is the **methodology + baselines**;
optimizations land against these numbers (measure → fix → re-measure, never optimize blind).

## How to run

```
SMTERM_PERF=1 make run     # runs the suite once on launch, prints a [PERF] JSON line to stdout
```

Or, in DevTools console of a normal run: `await window.__smtermPerf()`.

The harness lives in [`src/lib/perf.ts`](./src/lib/perf.ts) (dev-only; gated by `SMTERM_PERF`, never
runs in normal use). It uses the real Electron renderer (real WebGL) and the real `node-pty`/IPC path.

## What it measures

| Scenario     | Path exercised                                     | Metric                       |
| ------------ | -------------------------------------------------- | ---------------------------- |
| **renderer** | `term.write` → xterm parse → WebGL (no PTY/IPC)    | MB/s to drain 20 MB          |
| **e2e**      | shell → node-pty → **main→renderer IPC** → write   | MB/s + **IPC message count** |
| **idle**     | app sitting still (git poll, clock, status timers) | main/renderer CPU %          |
| **memory**   | RSS per process after the run                      | main / renderer / GPU MB     |

`app.getAppMetrics()` (main) supplies CPU/RSS. The e2e generator is a deterministic
`yes | head -n N` firehose bracketed by concatenation-built markers (so the shell's echo of the
command line doesn't trip the timing — see the comment in `perf.ts`).

## Baselines

Machine: Apple Silicon MacBook Pro, macOS, zsh (with shell integration). Dev build.

| Metric                         | 2026-07-08 (baseline)  | Notes                                   |
| ------------------------------ | ---------------------- | --------------------------------------- |
| Renderer throughput            | **~49 MB/s**           | 20 MB drained in ~410 ms (WebGL)        |
| End-to-end throughput          | **~21 MB/s**           | 14.5 MB in ~697 ms                      |
| **IPC messages / 14.5 MB**     | **~17,300**            | ⚠️ ~880 B per message — per-chunk sends |
| Idle CPU (main / renderer)     | **0% / 0%**            | background timers are effectively free  |
| Memory (main / renderer / GPU) | **~144 / 251 / 84 MB** | ~480 MB total (Electron baseline)       |

## Findings & next steps

1. **IPC coalescing is the clear win.** One command produced **~17.3k main→renderer messages**, and the
   IPC hop roughly halves throughput (49 → 21 MB/s). `main.ts` currently does one
   `event.sender.send` per `node-pty` `onData` chunk. **Fix:** buffer chunks in main and flush on a
   small timer (~4–8 ms) or size threshold, sending one message per flush. Expected: message count
   down ~10–50×, e2e throughput approaching the renderer ceiling.
2. **Flow control (follow-up).** Under a sustained firehose, pause `node-pty` when xterm's `write()`
   callback backlog grows and resume when drained, so the PTY can't outrun the renderer / balloon memory.
3. **Idle is already fine** — no action; keep it that way as features add timers.
4. **Not yet measured** (add scenarios as needed): input latency, N-busy-panes CPU/RSS scaling, huge-repo
   git-poll cost, and React re-render counts under high-frequency status updates.
