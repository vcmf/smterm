// Pure model for the file preview popup: the IPC result shape, the read/size
// guards, extension→language mapping, and HTML escaping. The fs read lives in
// main.ts; the highlighter is a lazy renderer shim (lib/highlighter.ts).

export const PREVIEW_READ_CAP = 256 * 1024 // bytes read/shown; larger → truncated note
export const PREVIEW_MAX_SIZE = 5 * 1024 * 1024 // hard cap: over this we don't read at all
export const HIGHLIGHT_MAX = 100 * 1024 // above this, render plain text (highlighting would jank)

// What `readFilePreview` returns — a discriminated union so the UI can render a
// real state for binaries / oversized / unreadable files instead of garbage.
export type PreviewData =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number }
  | { kind: "error"; message: string }

/** Classify a read file chunk into text vs binary (+ truncation). Pure so the
 *  decision is tested; main supplies size, bytes actually read, and the NUL sniff.
 *  (The too-large cap is handled in main before reading, to avoid loading huge files.) */
export function classifyPreview(
  size: number,
  bytesRead: number,
  hasNul: boolean,
): { kind: "text" | "binary"; truncated: boolean } {
  if (hasNul) return { kind: "binary", truncated: false }
  return { kind: "text", truncated: size > bytesRead }
}

// Extension / filename → highlight.js language id. null → render plain (no highlight).
// Curated to the languages actually registered in lib/highlighter.ts.
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  java: "java",
  rb: "ruby",
  sql: "sql",
}
const FILENAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".gitignore": "plaintext",
}

/** hljs language id for a path, by exact filename first then extension; null if unknown. */
export function languageForPath(p: string): string | null {
  const base = p.replace(/.*[/\\]/, "")
  const byName = FILENAME_LANG[base.toLowerCase()]
  if (byName) return byName === "plaintext" ? null : byName
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return null // no ext, or a dotfile with no further ext
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? null
}

/** Escape the five HTML-significant chars for safe rendering of un-highlighted text. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Human-readable byte size for the header (1023 B, 4.2 KB, 3.1 MB). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
