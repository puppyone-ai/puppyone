export const MARKDOWN_CODE_HIGHLIGHT_SOURCE_BYTE_LIMIT = 16 * 1024;
export const MARKDOWN_CODE_HIGHLIGHT_LINE_UNIT_LIMIT = 4 * 1024;
export const MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT = 2_048;

export function isWithinMarkdownCodeHighlightSourceBudget(code: string): boolean {
  let bytes = 0;
  let lineUnits = 0;
  for (let index = 0; index < code.length; index += 1) {
    const unit = code.charCodeAt(index);
    if (unit === 10) lineUnits = 0;
    else {
      lineUnits += 1;
      if (lineUnits > MARKDOWN_CODE_HIGHLIGHT_LINE_UNIT_LIMIT) return false;
    }
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < code.length) {
      const next = code.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > MARKDOWN_CODE_HIGHLIGHT_SOURCE_BYTE_LIMIT) return false;
  }
  return true;
}

export function estimateMarkdownCodeHighlightDomNodes(code: string): number {
  if (!code || !isWithinMarkdownCodeHighlightSourceBudget(code)) return 1;
  let runs = 0;
  let previousCategory = -1;
  for (let index = 0; index < code.length; index += 1) {
    const category = syntaxCharacterCategory(code.charCodeAt(index));
    if (category === previousCategory) continue;
    previousCategory = category;
    runs += 1;
    if (runs * 2 >= MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT) {
      return MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT;
    }
  }
  // Highlight trees commonly alternate styled tokens and unstyled gaps.
  return Math.max(1, Math.min(MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT, runs * 2));
}

function syntaxCharacterCategory(unit: number): number {
  if (unit === 9 || unit === 10 || unit === 13 || unit === 32) return 0;
  if (
    (unit >= 48 && unit <= 57)
    || (unit >= 65 && unit <= 90)
    || (unit >= 97 && unit <= 122)
    || unit === 95
    || unit > 0x7f
  ) return 1;
  if (unit === 34 || unit === 39 || unit === 96) return 2;
  return 3 + unit;
}
