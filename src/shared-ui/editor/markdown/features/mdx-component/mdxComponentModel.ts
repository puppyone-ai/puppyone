import type {
  MarkdownHtmlAttribute,
  MarkdownMdxComponentModel,
  MarkdownMdxTab,
} from "../../core/features/markdownFeatureData";
import {
  parseMdxComponentTagTokenAt,
  scanMdxComponentTagTokens,
  type MdxComponentTagToken,
} from "./mdxComponentSyntax";

const MAX_COMPONENT_NESTING = 64;
const MAX_TAB_COUNT = 64;
const MAX_TAB_LABEL_LENGTH = 200;

export function parseMarkdownMdxComponent(
  source: string,
  absoluteFrom = 0,
): MarkdownMdxComponentModel {
  const tokens = scanMdxComponentTagTokens(source, absoluteFrom);
  const first = tokens[0] ?? null;
  const metrics = getComponentMetrics(source, tokens);

  if (!first || first.closing || first.from !== absoluteFrom) {
    return failure("unknown", first?.name ?? "", "malformed", source, metrics, "component opening tag is invalid");
  }

  const paired = validateBalancedTokens(tokens);
  if (!paired.complete) {
    return failure(
      first.name === "Tabs" ? "tabs" : "unknown",
      first.name,
      "malformed",
      source,
      metrics,
      paired.diagnostic,
    );
  }

  if (first.name !== "Tabs") {
    return failure("unknown", first.name, "unsupported", source, metrics, `component ${first.name} is not registered`);
  }

  return parseTabsComponent(source, absoluteFrom, tokens, metrics);
}

function parseTabsComponent(
  source: string,
  absoluteFrom: number,
  tokens: readonly MdxComponentTagToken[],
  metrics: MarkdownMdxComponentModel["metrics"],
): MarkdownMdxComponentModel {
  const root = tokens[0];
  const rootClose = tokens[tokens.length - 1];
  if (source.slice(rootClose.to - absoluteFrom).trim()) {
    return failure("tabs", "Tabs", "malformed", source, metrics, "content follows the Tabs closing tag");
  }
  const rootAttributes = parseLiteralAttributes(root.attributesSource, root.from + root.name.length + 1);
  if (!rootAttributes.supported || rootAttributes.attributes.length > 0) {
    return failure("tabs", "Tabs", "unsupported", source, metrics, "Tabs does not accept props or expressions");
  }

  const tabs: MarkdownMdxTab[] = [];
  const stack: MdxComponentTagToken[] = [root];
  let directTextFrom = root.to;
  let activeTab: { opening: MdxComponentTagToken; label: string } | null = null;

  for (const token of tokens.slice(1, -1)) {
    if (token.closing) {
      const opening = stack.pop();
      if (!opening || opening.name !== token.name) {
        return failure("tabs", "Tabs", "malformed", source, metrics, `component closing tag ${token.name} is mismatched`);
      }
      if (opening.name === "Tab" && stack.length === 1 && activeTab) {
        tabs.push({
          label: activeTab.label,
          content: source.slice(activeTab.opening.to - absoluteFrom, token.from - absoluteFrom),
        });
        activeTab = null;
        directTextFrom = token.to;
      }
      continue;
    }

    if (stack.length === 1) {
      const interstitial = source.slice(directTextFrom - absoluteFrom, token.from - absoluteFrom);
      if (interstitial.trim()) {
        return failure("tabs", "Tabs", "unsupported", source, metrics, "Tabs accepts only Tab children");
      }
      if (token.name !== "Tab" || token.selfClosing) {
        return failure("tabs", "Tabs", "unsupported", source, metrics, "Tabs accepts only paired Tab children");
      }
      if (tabs.length >= MAX_TAB_COUNT) {
        return failure("tabs", "Tabs", "unsupported", source, metrics, "Tabs child limit exceeded");
      }
      const parsed = parseLiteralAttributes(token.attributesSource, token.from + token.name.length + 1);
      const label = parsed.attributes.find((attribute) => attribute.name === "label")?.value ?? null;
      if (
        !parsed.supported
        || parsed.attributes.length !== 1
        || !label
        || label.length > MAX_TAB_LABEL_LENGTH
      ) {
        return failure("tabs", "Tabs", "unsupported", source, metrics, "Tab requires one bounded literal label prop");
      }
      activeTab = { opening: token, label };
    }

    if (!token.selfClosing) stack.push(token);
  }

  const trailing = source.slice(directTextFrom - absoluteFrom, rootClose.from - absoluteFrom);
  if (trailing.trim() || tabs.length === 0) {
    return failure("tabs", "Tabs", "unsupported", source, metrics, "Tabs requires one or more Tab children");
  }

  return {
    kind: "tabs",
    name: "Tabs",
    status: "complete",
    source,
    tabs,
    diagnostic: null,
    metrics,
  };
}

function parseLiteralAttributes(
  source: string,
  absoluteFrom: number,
): { supported: boolean; attributes: MarkdownHtmlAttribute[] } {
  const attributes: MarkdownHtmlAttribute[] = [];
  let cursor = 0;
  const names = new Set<string>();

  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === "{" || source.startsWith("...", cursor)) {
      return { supported: false, attributes };
    }

    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
    if (!nameMatch) return { supported: false, attributes };
    const attributeFrom = cursor;
    const name = nameMatch[0];
    if (names.has(name)) return { supported: false, attributes };
    names.add(name);
    cursor += name.length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") return { supported: false, attributes };
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;

    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") return { supported: false, attributes };
    cursor += 1;
    const valueFrom = cursor;
    while (cursor < source.length && source[cursor] !== quote) cursor += 1;
    if (cursor >= source.length) return { supported: false, attributes };
    const value = source.slice(valueFrom, cursor);
    cursor += 1;
    attributes.push({
      name,
      value,
      from: absoluteFrom + attributeFrom,
      to: absoluteFrom + cursor,
    });
  }

  return { supported: true, attributes };
}

function validateBalancedTokens(tokens: readonly MdxComponentTagToken[]): {
  complete: boolean;
  diagnostic: string;
} {
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.closing) {
      if (stack.pop() !== token.name) {
        return { complete: false, diagnostic: `component closing tag ${token.name} is mismatched` };
      }
    } else if (!token.selfClosing) {
      stack.push(token.name);
      if (stack.length > MAX_COMPONENT_NESTING) {
        return { complete: false, diagnostic: "component nesting limit exceeded" };
      }
    }
  }
  return stack.length === 0
    ? { complete: true, diagnostic: "" }
    : { complete: false, diagnostic: `component ${stack[stack.length - 1]} is not closed` };
}

function getComponentMetrics(
  source: string,
  tokens: readonly MdxComponentTagToken[],
): MarkdownMdxComponentModel["metrics"] {
  let depth = 0;
  let maximumDepth = 0;
  for (const token of tokens) {
    if (token.closing) depth = Math.max(0, depth - 1);
    else if (!token.selfClosing) {
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
    }
  }
  return {
    logicalItems: tokens.length,
    estimatedDomNodes: Math.max(1, tokens.length * 2),
    nestingDepth: maximumDepth,
    assetCount: (source.match(/!\[|<img\b/gi) ?? []).length,
  };
}

function failure(
  kind: MarkdownMdxComponentModel["kind"],
  name: string,
  status: "malformed" | "unsupported",
  source: string,
  metrics: MarkdownMdxComponentModel["metrics"],
  diagnostic: string,
): MarkdownMdxComponentModel {
  return { kind, name, status, source, tabs: [], diagnostic, metrics };
}

/** Validates one complete tag in focused unit tests without exporting policy internals. */
export function parseMdxComponentOpeningTag(source: string) {
  return parseMdxComponentTagTokenAt(source, 0, 0);
}
