/** Claude Code's mark in currentColor — stands in for the terminal icon while Claude runs. */
export function ClaudeIcon({
  size = 14,
  color,
}: {
  size?: number
  color?: string
  weight?: string // accepted so it swaps in for a phosphor icon; the mark has one weight
}) {
  return (
    <svg
      data-icon="claude"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ color, flex: "none" }}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  )
}
