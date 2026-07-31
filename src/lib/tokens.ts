// Renderer-safe token display helpers (no fs — the summing lives in electron/transcript-tokens).
import type { TokenUsage } from "./agent-graph"

/** Headline "tokens used" — fresh input + cache writes + output. Excludes cache_read (the
 *  cheap repeated context), which otherwise dwarfs everything and reads as misleadingly huge. */
export const headlineTokens = (u: TokenUsage): number => u.input + u.cacheCreate + u.output

/** Compact human count: 1_234 → "1.2k", 4_500_000 → "4.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
  }
  const m = n / 1_000_000
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`
}

/** Full breakdown for a tooltip: "↓ 1.2k out · ↑ 3.4k in · 5k cache". */
export function tokenBreakdown(u: TokenUsage): string {
  const cache = u.cacheCreate + u.cacheRead
  return `↓ ${formatTokens(u.output)} out · ↑ ${formatTokens(u.input + u.cacheCreate)} in · ${formatTokens(cache)} cache`
}
