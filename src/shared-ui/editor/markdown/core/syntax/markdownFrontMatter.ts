import type { Text } from "@codemirror/state";

const FRONT_MATTER_MAX_LINES = 256;

/** YAML metadata exists only at the very top; the parser sees a rule and a heading. */
export function getMarkdownFrontMatterEndLine(doc: Text): number | null {
  if (doc.line(1).text.trimEnd() !== "---") return null;
  const lastLine = Math.min(doc.lines, FRONT_MATTER_MAX_LINES);
  for (let number = 2; number <= lastLine; number += 1) {
    if (doc.line(number).text.trimEnd() === "---") return number;
  }
  return null;
}
