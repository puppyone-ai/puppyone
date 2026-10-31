import {
  isEscapedInlineToken,
  scanUnescapedDelimiterOnLine,
  type InlineTokenClosingScan,
} from "../../shared/inlineTokenScan";

export type MarkdownLinkToken = {
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  hrefFrom: number;
  hrefTo: number;
  label: string;
  href: string;
};

export function findMarkdownLinkTokens(source: string): MarkdownLinkToken[] {
  const tokens: MarkdownLinkToken[] = [];

  for (let index = 0; index < source.length;) {
    if (
      source[index] !== "["
      || source[index - 1] === "!"
      || isEscapedInlineToken(source, index)
    ) {
      index += 1;
      continue;
    }

    const labelScan = scanUnescapedDelimiterOnLine(source, index + 1, "]");
    const labelTo = labelScan.closingIndex;
    if (labelTo <= index + 1 || source[labelTo + 1] !== "(") {
      index = labelScan.nextIndex;
      continue;
    }

    const hrefFrom = labelTo + 2;
    const hrefScan = findClosingParen(source, hrefFrom);
    const hrefTo = hrefScan.closingIndex;
    if (hrefTo <= hrefFrom) {
      index = hrefScan.nextIndex;
      continue;
    }

    const rawLabel = source.slice(index + 1, labelTo);
    const rawDestination = source.slice(hrefFrom, hrefTo);
    const href = parseMarkdownLinkDestination(rawDestination);
    if (!rawLabel.trim() || !href) {
      index = hrefTo + 1;
      continue;
    }

    tokens.push({
      from: index,
      to: hrefTo + 1,
      labelFrom: index + 1,
      labelTo,
      hrefFrom,
      hrefTo,
      label: rawLabel,
      href,
    });
    index = hrefTo + 1;
  }

  return tokens;
}

export function isExternalMarkdownHref(href: string): boolean {
  const value = href.trim();
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function findClosingParen(source: string, start: number): InlineTokenClosingScan {
  let escaped = false;
  let quote: "\"" | "'" | null = null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\n") return { closingIndex: -1, nextIndex: index + 1 };
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) return { closingIndex: index, nextIndex: index + 1 };
      depth -= 1;
    }
  }
  return { closingIndex: -1, nextIndex: source.length };
}

function parseMarkdownLinkDestination(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angleDestination = /^<([^>\n]+)>(?:\s+["'][^"']*["'])?$/.exec(trimmed);
  if (angleDestination) return angleDestination[1].trim() || null;

  const titleStart = findTrailingTitleStart(trimmed);
  const href = (titleStart == null ? trimmed : trimmed.slice(0, titleStart)).trim();
  return href || null;
}

function findTrailingTitleStart(value: string): number | null {
  const quote = value[value.length - 1];
  if (quote !== "\"" && quote !== "'") return null;

  for (let index = value.length - 2; index >= 0; index -= 1) {
    if (value[index] !== quote || isEscapedInlineToken(value, index)) continue;
    const beforeTitle = value.slice(0, index).trimEnd();
    if (!beforeTitle || beforeTitle.length === index) return null;
    return index;
  }

  return null;
}
