import { parseFragment, type DefaultTreeAdapterTypes as Tree } from "parse5";
import postcss from "postcss";
import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { DocumentTextEdit } from "../../document-session/CodeMirrorDocumentModel";
import { currentTarget, escapeHtmlAttribute, escapeHtmlText, type HtmlTarget } from "./htmlSourceIndex";

export const HTML_STYLE_PROPERTIES = ["font-family", "font-size", "font-weight", "color", "background-color",
  "text-align", "line-height", "margin", "padding", "border-radius", "width", "height"] as const;
export type HtmlStyleProperty = typeof HTML_STYLE_PROPERTIES[number];
export type HtmlEditOperation =
  | { kind: "text"; value: string }
  | { kind: "attribute"; name: "src" | "alt"; value: string }
  | { kind: "style"; property: HtmlStyleProperty; value: string };

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
  const textTree = parseFragment(rawText);
  const text = textTree.childNodes.map((node) => node.nodeName === "#text" ? (node as Tree.TextNode).value : "\n").join("");
  return { ...current, attrs, location, text, rawText };
}

export function compileHtmlEdit(target: HtmlTarget, changes: ChangeDesc | null, state: EditorState,
  operation: HtmlEditOperation): DocumentTextEdit[] {
  const current = readHtmlTarget(target, changes, state);
  if (operation.value.length > 65536 || operation.value.includes("\0")) throw new Error("invalid");
  if (operation.kind === "text") {
    if (!current.textEditable || current.textEnd === null) throw new Error("unsupported");
    if (operation.value === current.text) return [];
    // A plain-text region is the smallest supported semantic target; nested elements are never flattened.
    const escaped = escapeHtmlText(operation.value.replace(/\r\n?/g, "\n"));
    const value = ["pre", "code"].includes(current.tag) ? escaped : escaped.replace(/\n/g, "<br>");
    return [{ from: current.openEnd, to: current.textEnd, expectedText: current.rawText, insert: value }];
  }
  let name: string;
  let value: string;
  if (operation.kind === "attribute") {
    if (!current.image || !["src", "alt"].includes(operation.name)) throw new Error("unsupported");
    name = operation.name;
    value = operation.value;
    if (name === "src" && !isSafeImageReference(value)) throw new Error("invalid");
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
function escapeForQuote(value: string, quote: string): string {
  return escapeHtmlText(value).replace(quote === "'" ? /'/g : /"/g, quote === "'" ? "&#39;" : "&quot;");
}
