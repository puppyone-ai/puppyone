import type { MarkdownHtmlBlockStatus } from "../../core/features/markdownFeatureData";
import {
  findMarkdownHtmlSpecialConstructEnd,
  scanMarkdownHtmlTagTokens,
  type MarkdownHtmlTagToken,
} from "./htmlTagTokenizer";

export type MarkdownHtmlBlockStructure = Readonly<{
  status: MarkdownHtmlBlockStatus;
  tagName: string | null;
  tokens: readonly MarkdownHtmlTagToken[];
  diagnostic: string | null;
}>;

/**
 * Conservative authored-structure validation for one parser-owned HTMLBlock
 * or one parser-authoritatively reassembled HTML flow. Browser repair is
 * intentionally not accepted as proof of completeness.
 */
export function validateMarkdownHtmlBlockStructure(
  source: string,
  absoluteFrom = 0,
): MarkdownHtmlBlockStructure {
  const special = classifyRootSpecialConstruct(source);
  const tokens = scanMarkdownHtmlTagTokens(source, absoluteFrom);
  const firstOpening = tokens.find((token) => !token.closing) ?? null;

  if (special) {
    return {
      status: special.complete ? "unsupported" : "incomplete",
      tagName: null,
      tokens,
      diagnostic: special.complete
        ? `${special.kind} HTML blocks remain source-visible`
        : `${special.kind} HTML block is incomplete`,
    };
  }

  if (!firstOpening) {
    return {
      status: looksLikeIncompleteTag(source) ? "incomplete" : "malformed",
      tagName: null,
      tokens,
      diagnostic: looksLikeIncompleteTag(source)
        ? "HTML opening tag is incomplete"
        : "HTML block has no valid opening element",
    };
  }

  const stack: MarkdownHtmlTagToken[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const tokenFrom = token.from - absoluteFrom;
    const tokenTo = token.to - absoluteFrom;
    const parent = stack.at(-1) ?? null;
    if (
      parent
      && tableContextRepairsText(parent.tagName)
      && hasSignificantText(source.slice(cursor, tokenFrom))
    ) {
      return failure(
        "malformed",
        firstOpening.tagName,
        tokens,
        `text inside <${parent.tagName}> would be moved by the HTML parser`,
      );
    }

    if (!token.closing) {
      if (hasDuplicateAttribute(token)) {
        return failure(
          "malformed",
          firstOpening.tagName,
          tokens,
          `duplicate attribute on <${token.tagName}> changes browser interpretation`,
        );
      }
      if (parent && openingTagTriggersBrowserRepair(parent.tagName, token.tagName)) {
        return failure(
          "malformed",
          firstOpening.tagName,
          tokens,
          `<${token.tagName}> would implicitly close <${parent.tagName}>`,
        );
      }
      if (parent && invalidTableChild(parent.tagName, token.tagName)) {
        return failure(
          "malformed",
          firstOpening.tagName,
          tokens,
          `<${token.tagName}> would be reparented outside <${parent.tagName}>`,
        );
      }
      if (!token.selfClosing) stack.push(token);
      cursor = tokenTo;
      continue;
    }

    const opening = stack.at(-1) ?? null;
    if (!opening) {
      return failure(
        "malformed",
        firstOpening.tagName,
        tokens,
        `closing tag </${token.tagName}> has no authored opening tag`,
      );
    }
    if (opening.tagName !== token.tagName) {
      return failure(
        "malformed",
        firstOpening.tagName,
        tokens,
        `closing tag </${token.tagName}> does not match <${opening.tagName}>`,
      );
    }
    stack.pop();
    cursor = tokenTo;
  }

  const incomplete = stack.at(-1) ?? null;
  if (incomplete) {
    return failure(
      "incomplete",
      firstOpening.tagName,
      tokens,
      `HTML element <${incomplete.tagName}> is not closed`,
    );
  }

  return {
    status: "complete",
    tagName: firstOpening.tagName,
    tokens,
    diagnostic: null,
  };
}

const P_IMPLICIT_CLOSE_START_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

function openingTagTriggersBrowserRepair(parent: string, child: string): boolean {
  if (parent === "p" && P_IMPLICIT_CLOSE_START_TAGS.has(child)) return true;
  if (parent === "li" && child === "li") return true;
  if ((parent === "dt" || parent === "dd") && (child === "dt" || child === "dd")) return true;
  if (parent === "tr" && child === "tr") return true;
  if ((parent === "td" || parent === "th") && (child === "td" || child === "th")) return true;
  if (/^h[1-6]$/.test(parent) && /^h[1-6]$/.test(child)) return true;
  return parent === "a" && child === "a";
}

function invalidTableChild(parent: string, child: string): boolean {
  if (parent === "table") {
    return !new Set(["caption", "col", "colgroup", "thead", "tbody", "tfoot", "tr"]).has(child);
  }
  if (parent === "thead" || parent === "tbody" || parent === "tfoot") return child !== "tr";
  if (parent === "tr") return child !== "td" && child !== "th";
  return false;
}

function tableContextRepairsText(tagName: string): boolean {
  return tagName === "table"
    || tagName === "thead"
    || tagName === "tbody"
    || tagName === "tfoot"
    || tagName === "tr";
}

function hasSignificantText(source: string): boolean {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<![^>]*>/g, "")
    .trim() !== "";
}

function failure(
  status: Extract<MarkdownHtmlBlockStatus, "incomplete" | "malformed">,
  tagName: string,
  tokens: readonly MarkdownHtmlTagToken[],
  diagnostic: string,
): MarkdownHtmlBlockStructure {
  return { status, tagName, tokens, diagnostic };
}

function hasDuplicateAttribute(token: MarkdownHtmlTagToken): boolean {
  const names = new Set<string>();
  for (const attribute of token.attributes) {
    if (names.has(attribute.name)) return true;
    names.add(attribute.name);
  }
  return false;
}

function looksLikeIncompleteTag(source: string): boolean {
  const trimmed = source.trimStart();
  return trimmed.startsWith("<") && !trimmed.includes(">");
}

function classifyRootSpecialConstruct(source: string): {
  kind: "comment" | "CDATA" | "declaration" | "processing-instruction";
  complete: boolean;
} | null {
  const trimmed = source.trimStart();
  const kind = trimmed.startsWith("<!--")
    ? "comment"
    : trimmed.startsWith("<![CDATA[")
      ? "CDATA"
      : trimmed.startsWith("<?")
        ? "processing-instruction"
        : trimmed.startsWith("<!")
          ? "declaration"
          : null;
  if (!kind) return null;
  return {
    kind,
    complete: findMarkdownHtmlSpecialConstructEnd(trimmed, 0) !== -1,
  };
}
