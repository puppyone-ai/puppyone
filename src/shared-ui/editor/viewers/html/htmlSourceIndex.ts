import { parse, type DefaultTreeAdapterTypes as Tree } from "parse5";
import type { ChangeDesc, EditorState } from "@codemirror/state";

export const HTML_TARGET_ATTRIBUTE = "data-puppyone-html-target";
export const HTML_VISUAL_MAX_CHARS = 512 * 1024;
export const HTML_VISUAL_MAX_NODES = 12000;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const TEXT_TAGS = new Set("h1 h2 h3 h4 h5 h6 p span a button label li dt dd td th caption figcaption strong em b i u s small mark sub sup pre code blockquote div section header footer main article aside nav".split(" "));
const EXCLUDED = new Set("template script style noscript select textarea svg math head iframe object applet".split(" "));

export type HtmlTarget = Readonly<{
  id: string;
  tag: string;
  start: number;
  openEnd: number;
  textEnd: number | null;
  textEditable: boolean;
  image: boolean;
}>;
export type HtmlSourceIndex = {
  tree: Tree.Document;
  targets: Map<string, HtmlTarget>;
  nodes: Map<Tree.Element, string>;
  baseHref: string | null;
  editable: boolean;
};

export function parseHtmlSource(source: string, path: string): HtmlSourceIndex {
  const issues: string[] = [];
  const tree = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: true,
    onParseError: (error) => { if (issues.length < 100) issues.push(error.code); } });
  const targets = new Map<string, HtmlTarget>();
  const nodes = new Map<Tree.Element, string>();
  const starts = new Map<number, Tree.Element[]>();
  const elements: Tree.Element[] = [];
  const pending: { node: Tree.Node; excluded: boolean; picture: boolean; depth: number }[] = [{ node: tree, excluded: false, picture: false, depth: 0 }];
  const responsiveImages = new Set<Tree.Element>();
  let count = 0;
  let baseHref: string | null = null;
  let supportedEncoding = true;
  let supportedDepth = true;
  while (pending.length) {
    const { node, excluded, picture, depth } = pending.pop()!;
    if (depth > 256) supportedDepth = false;
    count++;
    if (isHtmlElement(node)) {
      if (!excluded) elements.push(node);
      if (picture) responsiveImages.add(node);
      if (node.tagName === "base" && baseHref === null) baseHref = attribute(node, "href") ?? null;
      if (node.tagName === "meta") {
        const charset = attribute(node, "charset") ?? /charset\s*=\s*([^;\s]+)/i.exec(attribute(node, "content") ?? "")?.[1];
        if (charset && !/^utf-?8$/i.test(charset)) supportedEncoding = false;
      }
      const start = node.sourceCodeLocation?.startTag?.startOffset;
      if (start !== undefined) starts.set(start, [...(starts.get(start) ?? []), node]);
    }
    if ("childNodes" in node) for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push({
      node: node.childNodes[index]!, depth: depth + 1,
      excluded: excluded || "tagName" in node && EXCLUDED.has(node.tagName),
      picture: picture || "tagName" in node && node.tagName === "picture",
    });
  }
  // Templating and malformed markup cannot safely acquire write authority.
  const editable = /\.html?$/i.test(path) && source.length <= HTML_VISUAL_MAX_CHARS
    && count <= HTML_VISUAL_MAX_NODES && supportedEncoding && supportedDepth && !/(?:<%|<\?|\{\{|\{%|\{#)/.test(source)
    && issues.every((code) => code === "missing-doctype");
  if (editable) for (const node of elements) {
    const location = node.sourceCodeLocation;
    if (!location?.startTag || starts.get(location.startTag.startOffset)?.length !== 1
      || location.startTag.endOffset - location.startTag.startOffset > 32768
      || !TEXT_TAGS.has(node.tagName) && node.tagName !== "img") continue;
    const id = `t${targets.size.toString(36)}`;
    const text = TEXT_TAGS.has(node.tagName) && !!location.endTag
      && location.endTag.startOffset - location.startTag.endOffset <= 65536 && node.childNodes.every((child) => (
      child.nodeName === "#text" || isHtmlElement(child) && child.tagName === "br"
    ));
    targets.set(id, { id, tag: node.tagName, start: location.startTag.startOffset,
      openEnd: location.startTag.endOffset, textEnd: location.endTag?.startOffset ?? null, textEditable: text,
      image: node.tagName === "img" && !attribute(node, "srcset") && !attribute(node, "sizes")
        && !responsiveImages.has(node),
    });
    nodes.set(node, id);
  }
  return { tree, targets, nodes, baseHref, editable };
}

export function currentTarget(target: HtmlTarget, changes: ChangeDesc | null, state: EditorState) {
  const map = (offset: number, assoc: number) => changes?.mapPos(offset, assoc) ?? offset;
  const start = map(target.start, -1);
  const openEnd = map(target.openEnd, -1);
  const textEnd = target.textEnd === null ? null : map(target.textEnd, 1);
  const opening = state.doc.sliceString(start, openEnd);
  // Parse a bounded opening tag to obtain current attributes without parsing the document on input.
  if (opening.length > 32768) throw new Error("unsupported");
  return { ...target, start, openEnd, textEnd, opening };
}

export function isHtmlElement(node: Tree.Node): node is Tree.Element {
  return "tagName" in node && node.namespaceURI === HTML_NAMESPACE;
}
export function attribute(node: Tree.Element, name: string): string | undefined {
  return node.attrs.find((entry) => entry.name === name)?.value;
}
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}
