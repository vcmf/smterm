// Programming ligatures (JetBrains Mono). Longest-first so greedy matching wins
// (e.g. "==>" before "==").
const LIGATURES = [
  "<==>",
  "<-->",
  "<==",
  "==>",
  "<--",
  "-->",
  "===",
  "!==",
  "=/=",
  "<=>",
  "///",
  "<<=",
  ">>=",
  "...",
  "::=",
  "<=",
  "=>",
  "==",
  "!=",
  ">=",
  "->",
  "<-",
  "::",
  "&&",
  "||",
  "++",
  "--",
  "|>",
  "<|",
  "//",
  "/*",
  "*/",
  "..",
  ">>",
  "<<",
  "??",
  "?.",
  "|=",
  "=~",
  "!~",
  "**",
].sort((a, b) => b.length - a.length);

/**
 * xterm character joiner: returns [start, end) ranges covering ligature
 * sequences in a line. The canvas renderer draws each joined range as one run,
 * so the font's ligature glyph is applied. Pure — unit-tested.
 */
export function ligatureRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const lig = LIGATURES.find((l) => text.startsWith(l, i));
    if (lig) {
      ranges.push([i, i + lig.length]);
      i += lig.length;
    } else {
      i += 1;
    }
  }
  return ranges;
}
