export type InlineTokenClosingScan = {
  closingIndex: number;
  nextIndex: number;
};

/**
 * Finds an unescaped delimiter without crossing a physical line boundary.
 * `nextIndex` lets callers skip the already-inspected range after a malformed
 * token instead of rescanning the same suffix for every opening marker.
 */
export function scanUnescapedDelimiterOnLine(
  source: string,
  start: number,
  delimiter: string,
): InlineTokenClosingScan {
  let escaped = false;

  for (let index = Math.max(0, start); index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") {
      return { closingIndex: -1, nextIndex: index + 1 };
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (source.startsWith(delimiter, index)) {
      return { closingIndex: index, nextIndex: index + delimiter.length };
    }
  }

  return { closingIndex: -1, nextIndex: source.length };
}

export function isEscapedInlineToken(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
