import { parseFragment, type DefaultTreeAdapterTypes as Tree } from "parse5";
import postcss from "postcss";
import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { DocumentTextEdit } from "../../document-session/CodeMirrorDocumentModel";
import { currentTarget, escapeHtmlAttribute, escapeHtmlText, isHtmlElement, type HtmlTarget } from "./htmlSourceIndex";

export const HTML_STYLE_PROPERTIES = ["font-family", "font-size", "font-weight", "color", "background-color",
  "text-align", "line-height", "margin", "padding", "border-radius", "width", "height"] as const;
export type HtmlStyleProperty = typeof HTML_STYLE_PROPERTIES[number];
export type HtmlStructuralAction = "duplicate" | "move-up" | "move-down" | "delete";
export type HtmlEditOperation =
  | { kind: "text"; value: string }
  | { kind: "attribute"; name: "src" | "alt" | "href"; value: string }
  | { kind: "style"; property: HtmlStyleProperty; value: string }
  | { kind: "structure"; action: HtmlStructuralAction; siblingTarget?: HtmlTarget | null };

export function readHtmlTarget(target: HtmlTarget, changes: ChangeDesc | null, state: EditorState) {
  const current = currentTarget(target, changes, state);
  // A neutral span retains attribute source locations even for td, tr and other contextual tags.
  const tagLength = current.tag.length;
  const neutral = `<span${current.opening.slice(tagLength + 1)}`;
  const element = parseFragment(`${neutral}</span>`, { sourceCodeLocationInfo: true }).childNodes[0] as Tree.Element;
  const offsetDelta = tagLength - 4;
  const attrs = new Map(element.attrs.map((attr) => [attr.name, attr.value]));
  const location = (name: string) => {
    const range = element.sourceCodeLocation?.attrs?.[name];
    return range ? { from: current.start + range.startOffset + offsetDelta, to: current.start + range.endOffset + offsetDelta } : null;
  };
  const rawText = current.textEditable && current.textEnd !== null ? state.doc.sliceString(current.openEnd, current.textEnd) : "";
  const textTree = parseFragment(rawText, { sourceCodeLocationInfo: true });
  const inlineElements: string[] = [];
  const text = textTree.childNodes.map((node) => {
    if (node.nodeName === "#text") return (node as Tree.TextNode).value;
    if (isHtmlElement(node) && node.tagName === "br") return "\n";
    if (isHtmlElement(node) && node.sourceCodeLocation) {
      inlineElements.push(rawText.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset));
      return "\u0001";
    }
    return "";
  }).join("");
  return { ...current, attrs, location, text, rawText, inlineElements };
}

export function compileHtmlEdit(target: HtmlTarget, changes: ChangeDesc | null, state: EditorState,
  operation: HtmlEditOperation): DocumentTextEdit[] {
  const current = readHtmlTarget(target, changes, state);
  if (operation.kind === "structure") {
    if (!current.blockMovable || current.end <= current.start) throw new Error("unsupported");
    const elementSlice = state.doc.sliceString(current.start, current.end);
    const lookback = state.doc.sliceString(Math.max(0, current.start - 128), current.start);
    const indentMatch = /\n([ \t]*)$/.exec(lookback);
    if (operation.action === "duplicate") {
      const separator = indentMatch ? `\n${indentMatch[1]}` : "\n";
      return [{ from: current.end, to: current.end, expectedText: "", insert: `${separator}${elementSlice}` }];
    }
    if (operation.action === "delete") {
      const deleteFrom = indentMatch ? current.start - indentMatch[0].length : current.start;
      return [{ from: deleteFrom, to: current.end, expectedText: state.doc.sliceString(deleteFrom, current.end), insert: "" }];
    }
    if (!operation.siblingTarget) throw new Error("unsupported");
    const sibling = currentTarget(operation.siblingTarget, changes, state);
    if (operation.action === "move-up") {
      if (sibling.end > current.start) throw new Error("unsupported");
      const prevSlice = state.doc.sliceString(sibling.start, sibling.end);
      const between = state.doc.sliceString(sibling.end, current.start);
      const expectedText = state.doc.sliceString(sibling.start, current.end);
      return [{ from: sibling.start, to: current.end, expectedText, insert: `${elementSlice}${between}${prevSlice}` }];
    }
    if (sibling.start < current.end) throw new Error("unsupported");
    const nextSlice = state.doc.sliceString(sibling.start, sibling.end);
    const between = state.doc.sliceString(current.end, sibling.start);
    const expectedText = state.doc.sliceString(current.start, sibling.end);
    return [{ from: current.start, to: sibling.end, expectedText, insert: `${nextSlice}${between}${elementSlice}` }];
  }
  if (operation.value.length > 65536 || operation.value.includes("\0")) throw new Error("invalid");
  if (operation.kind === "text") {
    if (!current.textEditable || current.textEnd === null) throw new Error("unsupported");
    if (operation.value === current.text) return [];
    const preserveNewlines = ["pre", "code"].includes(current.tag);
    const formatSegment = (segment: string) => {
      const escaped = escapeHtmlText(segment.replace(/\r\n?/g, "\n"));
      return preserveNewlines ? escaped : escaped.replace(/\n/g, "<br>");
    };
    let value: string;
    if (current.inlineElements.length > 0) {
      const segments = operation.value.split("\u0001");
      if (segments.length !== current.inlineElements.length + 1) throw new Error("unsupported");
      value = segments.map((seg, i) => formatSegment(seg) + (current.inlineElements[i] ?? "")).join("");
    } else {
      if (operation.value.includes("\u0001")) throw new Error("invalid");
      value = formatSegment(operation.value);
    }
    if (value === current.rawText) return [];
    return minimalTextDiff(current.openEnd, current.rawText, value);
  }
  let name: string;
  let value: string;
  if (operation.kind === "attribute") {
    if (operation.name === "href") {
      if (!current.link || !isSafeLinkReference(operation.value)) throw new Error("invalid");
      name = "href";
      value = operation.value.trim();
    } else {
      if (!current.image || !["src", "alt"].includes(operation.name)) throw new Error("unsupported");
      name = operation.name;
      value = operation.value;
      if (name === "src" && !isSafeImageReference(value)) throw new Error("invalid");
    }
  } else {
    if (!HTML_STYLE_PROPERTIES.includes(operation.property) || !validStyleValue(operation.property, operation.value)) throw new Error("invalid");
    name = "style";
    const original = current.attrs.get("style") ?? "";
    const root = postcss.parse(`a{${original}}`);
    const rule = root.first;
    if (!rule || rule.type !== "rule" || rule.nodes.some((node) => node.type !== "decl" && node.type !== "comment")) throw new Error("unsupported");
    const declarations = rule.nodes.filter((node) => node.type === "decl" && node.prop.toLowerCase() === operation.property);
    if (declarations.length > 1 || declarations.some((node) => node.type === "decl" && node.important)) throw new Error("unsupported");
    if (operation.value === "") declarations.forEach((node) => node.remove());
    else if (declarations[0]?.type === "decl") declarations[0].value = operation.value;
    else rule.append({ prop: operation.property, value: operation.value, raws: { before: original ? " " : "", between: ": " } });
    const serialized = rule.toString();
    value = serialized.slice(serialized.indexOf("{") + 1, -1);
  }
  if (current.attrs.get(name) === value) return [];
  const range = current.location(name);
  if (range) {
    const old = state.doc.sliceString(range.from, range.to);
    const match = /^([^=\s]+)(\s*=\s*)(["'])([\s\S]*)\3$/.exec(old);
    const insert = match ? `${match[1]}${match[2]}${match[3]}${escapeForQuote(value, match[3])}${match[3]}`
      : `${name}="${escapeHtmlAttribute(value)}"`;
    return [{ ...range, expectedText: old, insert }];
  }
  // In unquoted src=x/>, the slash belongs to the value, not a self-closing delimiter.
  const closingSlash = current.opening.endsWith("/>")
    && [...current.attrs.keys()].every((key) => (current.location(key)?.to ?? 0) <= current.openEnd - 2);
  const position = current.openEnd - (closingSlash ? 2 : 1);
  return [{ from: position, to: position, expectedText: "", insert: ` ${name}="${escapeHtmlAttribute(value)}"` }];
}

export function validStyleValue(property: string, value: string): boolean {
  return value.length <= 256 && !/[;{}<>!\\\u0000-\u001f]/.test(value)
    && !/(?:url|expression|attr)\s*\(/i.test(value)
    && (value === "" || typeof CSS === "undefined" || !CSS.supports || CSS.supports(property, value));
}
export function isSafeImageReference(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && !/[\u0000-\u0020\\]/.test(value)
    && !/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(value) && !/[?#]/.test(value)
    && !value.split("/").some((part) => /^(?:%2e){1,2}$/i.test(part));
}
export function isSafeLinkReference(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length > 4096 || /[\u0000-\u001f]/.test(trimmed)) return false;
  if (/^(?:javascript|data|vbscript|file):/i.test(trimmed)) return false;
  return true;
}
function minimalTextDiff(baseOffset: number, oldText: string, newText: string): DocumentTextEdit[] {
  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && prefix < minLen) {
    const code = oldText.charCodeAt(prefix - 1);
    if (code >= 0xd800 && code <= 0xdbff) prefix--;
  }
  let suffix = 0;
  while (suffix < minLen - prefix && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) suffix++;
  if (suffix > 0) {
    const code = oldText.charCodeAt(oldText.length - suffix);
    if (code >= 0xdc00 && code <= 0xdfff) suffix--;
  }
  return [{
    from: baseOffset + prefix,
    to: baseOffset + oldText.length - suffix,
    expectedText: oldText.slice(prefix, oldText.length - suffix),
    insert: newText.slice(prefix, newText.length - suffix),
  }];
}
function escapeForQuote(value: string, quote: string): string {
  return escapeHtmlText(value).replace(quote === "'" ? /'/g : /"/g, quote === "'" ? "&#39;" : "&quot;");
}
