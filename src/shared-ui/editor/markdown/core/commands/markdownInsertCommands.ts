import { ChangeSet, EditorSelection, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { getMarkdownElementsInRange, type MarkdownMarkerRange } from "../syntax/markdownElements";
import { getMarkdownFrontMatterEndLine } from "../syntax/markdownFrontMatter";
import { getMarkdownInsertBoundaries } from "../syntax/markdownInsertBoundaries";
import { getSelectedLineNumbers } from "./markdownBlockCommands";

export const requestMarkdownTableEffect = StateEffect.define<null>();
export type MarkdownTableShape = Readonly<{ rows: number; columns: number }>;
function editable(view: EditorView): boolean {
  return !view.state.readOnly && view.state.selection.ranges.length === 1;
}
/** Structural commands must not become literal text inside code, raw HTML, or metadata. */
function canInsertAtSelection(view: EditorView): boolean {
  if (!editable(view)) return false;
  const selection = view.state.selection.main;
  const metadataEnd = getMarkdownFrontMatterEndLine(view.state.doc);
  if (metadataEnd !== null && selection.from <= view.state.doc.line(metadataEnd).to) return false;
  for (const position of [selection.from, Math.max(selection.from, selection.to - 1)]) {
    let node = syntaxTree(view.state).resolveInner(position, 1);
    while (node.parent && node.parent.name !== "Document") node = node.parent;
    if (!/^(?:FencedCode|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock|BlockMath)$/.test(node.name)) continue;
    if (!selection.empty && selection.from <= node.from && selection.to >= node.to) continue;
    if (selection.empty && selection.from === node.from) continue;
    return false;
  }
  return true;
}
/** Insert one transaction, retaining separation from neighboring paragraphs. */
function paragraphPadding(edge: string, side: "before" | "after"): string {
  if (!edge) return "";
  const atBoundary = side === "before" ? edge.endsWith("\n\n") : edge.startsWith("\n\n");
  if (atBoundary) return "";
  const atNewline = side === "before" ? edge.endsWith("\n") : edge.startsWith("\n");
  return atNewline ? "\n" : "\n\n";
}
function insertBlock(view: EditorView, source: string, caretOffset: number): boolean {
  if (!canInsertAtSelection(view)) return false;
  const { from, to } = view.state.selection.main;
  const before = view.state.sliceDoc(Math.max(0, from - 2), from);
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2));
  const prefix = paragraphPadding(before, "before");
  const suffix = paragraphPadding(after, "after");
  view.dispatch({ changes: { from, to, insert: prefix + source + suffix },
    selection: EditorSelection.cursor(from + prefix.length + caretOffset),
    scrollIntoView: true, userEvent: "input.markdown.insert" });
  return true;
}
export function insertMarkdownCodeBlock(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const content = view.state.sliceDoc(from, to);
  let fenceLength = 3;
  for (const match of content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  return insertBlock(view, `${fence}\n${content}\n${fence}`, fence.length + 1);
}
export function insertMarkdownMathBlock(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const source = view.state.sliceDoc(from, to);
  if (/^\s*\$\$\s*$/m.test(source)) return false;
  return insertBlock(view, `$$\n${source}\n$$`, 3);
}
export function requestMarkdownTable(view: EditorView): boolean {
  if (!canInsertAtSelection(view)) return false;
  view.dispatch({ effects: requestMarkdownTableEffect.of(null) });
  return true;
}
export function insertMarkdownTable(view: EditorView, { rows, columns }: MarkdownTableShape): boolean {
  if (!editable(view) || !Number.isInteger(rows) || !Number.isInteger(columns)
    || rows < 1 || rows > 50 || columns < 1 || columns > 20 || rows * columns > 500) return false;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const header = row(Array.from({ length: columns }, (_, index) => index === 0 ? selected : ""));
  const separator = row(Array<string>(columns).fill("---"));
  const body = Array.from({ length: rows - 1 }, () => row(Array<string>(columns).fill("")));
  return insertBlock(view, [header, separator, ...body].join("\n"), 2);
}
export function insertMarkdownRule(view: EditorView): boolean { return insertBlock(view, "---", 3); }
function insertReference(view: EditorView, marker: string, definition: string, caretOffset: number): boolean {
  if (!canInsertAtSelection(view)) return false;
  const { from, to } = view.state.selection.main;
  const end = view.state.doc.length;
  if (!getMarkdownInsertBoundaries(view.state)?.endAllowed) return false;
  const remainingEnd = view.state.sliceDoc(Math.max(to, end - 2), end);
  const separator = to === end ? "\n\n" : paragraphPadding(remainingEnd, "before");
  const tail = separator + definition;
  const changes = to === end ? [{ from, to, insert: marker + tail }]
    : [{ from, to, insert: marker }, { from: end, insert: tail }];
  const newLength = end - (to - from) + marker.length + tail.length;
  view.dispatch({ changes, selection: EditorSelection.cursor(newLength - definition.length + caretOffset),
    scrollIntoView: true, userEvent: "input.markdown.reference" });
  return true;
}
export function insertMarkdownFootnote(view: EditorView): boolean {
  if (!editable(view)) return false;
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  let id = 1;
  while (text.includes(`[^${id}]`)) id++;
  const content = view.state.sliceDoc(from, to).replace(/\n/g, "\n    ");
  const prefix = `[^${id}]: `;
  return insertReference(view, `[^${id}]`, prefix + content, prefix.length);
}
export function insertMarkdownReferenceLink(view: EditorView): boolean {
  if (!editable(view)) return false;
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString().toLowerCase();
  let id = 1;
  while (text.includes(`[link-${id}]`)) id++;
  const label = view.state.sliceDoc(from, to).replace(/([\\[\]])/g, "\\$1").replace(/\n/g, " ");
  const definition = `[link-${id}]: `;
  return insertReference(view, `[${label}][link-${id}]`, definition, definition.length);
}
/** Remove only selected formats and escape any newly exposed literal code. */
export function clearMarkdownFormatting(view: EditorView): boolean {
  if (!editable(view)) return false;
  const selection = view.state.selection.main;
  const removals: MarkdownMarkerRange[] = [];
  const replacements: { from: number; to: number; insert: string }[] = [];
  const boundaries: { position: number; text: string; order: number }[] = [];
  for (const element of getMarkdownElementsInRange(view.state, Math.max(0, selection.from - 1), Math.min(view.state.doc.length, selection.to + 1))) {
    const format = ["strong", "emphasis", "strike", "inlineCode", "highlight"].includes(element.kind)
      || (element.kind === "inlineHtml" && element.inlineHtml.status === "complete"
        && ["u", "strong", "em", "s", "del", "mark", "code"].includes(element.inlineHtml.tagName));
    const content = element.contentRange;
    if (!format || !content || element.markerRanges.length < 2) continue;
    const from = selection.empty ? content.from : Math.max(selection.from, content.from);
    const to = selection.empty ? content.to : Math.min(selection.to, content.to);
    if (from >= to || (selection.empty && (selection.from < content.from || selection.from > content.to))) continue;
    const opening = element.markerRanges[0];
    const closing = element.markerRanges[element.markerRanges.length - 1];
    const partial = from > content.from || to < content.to;
    const htmlTags: Readonly<Record<string, string>> = { strong: "strong", emphasis: "em", strike: "del", highlight: "mark", inlineCode: "code" };
    const tag = htmlTags[element.kind];
    const openText = partial && tag ? `<${tag}>` : view.state.sliceDoc(opening.from, opening.to);
    const closeText = partial && tag ? `</${tag}>` : view.state.sliceDoc(closing.from, closing.to);
    if (from === content.from) removals.push(opening);
    else {
      replacements.push({ ...opening, insert: openText });
      boundaries.push({ position: from, text: closeText, order: -element.from });
    }
    if (to === content.to) removals.push(closing);
    else {
      replacements.push({ ...closing, insert: closeText });
      boundaries.push({ position: to, text: openText, order: element.from });
    }
    if (element.kind === "inlineCode") {
      const segments = partial ? [[content.from, from], [from, to], [to, content.to]] : [[from, to]];
      for (const [start, end] of segments) {
        if (start === end) continue;
        const literal = view.state.sliceDoc(start, end);
        const escaped = Array.from(literal, character => {
          const code = character.charCodeAt(0);
          const punctuation = code >= 33 && code <= 47 || code >= 58 && code <= 64
            || code >= 91 && code <= 96 || code >= 123 && code <= 126;
          return punctuation ? "\\" + character : character;
        }).join("");
        replacements.push({ from: start, to: end, insert: escaped });
      }
    }
  }
  if (!removals.length && !boundaries.length && !replacements.length) return false;
  const merged: MarkdownMarkerRange[] = [];
  for (const marker of removals.sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1);
    if (previous && marker.from <= previous.to) previous.to = Math.max(previous.to, marker.to);
    else merged.push({ ...marker });
  }
  const insertions = new Map<number, string>();
  for (const boundary of boundaries.sort((a, b) => a.order - b.order)) {
    insertions.set(boundary.position, (insertions.get(boundary.position) ?? "") + boundary.text);
  }
  const edits = [
    ...merged.map(marker => ({ ...marker, insert: "" })), ...replacements,
    ...[...insertions].map(([from, insert]) => ({ from, to: from, insert })),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  const changes = ChangeSet.of(edits, view.state.doc.length);
  view.dispatch({ changes, selection: selection.map(changes), userEvent: "input.markdown.clear" });
  return true;
}
export function adjustMarkdownHeading(view: EditorView, delta: 1 | -1): boolean {
  if (!editable(view)) return false;
  const metadataEnd = getMarkdownFrontMatterEndLine(view.state.doc);
  const changes: { from: number; to: number; insert: string }[] = [];
  const touched = new Set<number>();
  for (const number of getSelectedLineNumbers(view.state)) {
    if (metadataEnd !== null && number <= metadataEnd) continue;
    const line = view.state.doc.line(number);
    let node = syntaxTree(view.state).resolveInner(Math.min(line.to, line.from + 1), 1);
    while (node.parent && node.parent.name !== "Document") node = node.parent;
    if (!/^(?:ATXHeading[1-6]|SetextHeading[12]|Paragraph)$/.test(node.name)) continue;
    if (touched.has(node.from)) continue;
    touched.add(node.from);
    const setext = /^SetextHeading([12])$/.exec(node.name);
    const marker = /^(#{1,6})\s+/.exec(line.text);
    const currentLevel = setext ? Number(setext[1]) : marker?.[1].length ?? 0;
    const level = Math.max(0, Math.min(6, currentLevel + delta));
    const insert = level ? "#".repeat(level) + " " : "";
    if (setext) {
      const first = view.state.doc.lineAt(node.from);
      const last = view.state.doc.lineAt(node.to);
      const content = view.state.sliceDoc(first.from, last.from).trimEnd();
      changes.push({ from: first.from, to: last.to, insert: insert + content });
    } else changes.push({ from: line.from, to: line.from + (marker?.[0].length ?? 0), insert });
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.markdown.heading" });
  return true;
}

export function insertMarkdownParagraph(view: EditorView, side: "before" | "after"): boolean {
  if (!editable(view)) return false;
  let node = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1);
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const from = node.parent ? node.from : line.from;
  const to = node.parent ? node.to : line.to;
  const position = side === "before" ? from : to;
  view.dispatch({ changes: { from: position, insert: "\n\n" },
    selection: EditorSelection.cursor(position + (side === "after" ? 2 : 0)),
    scrollIntoView: true, userEvent: "input.markdown.paragraph" });
  return true;
}
export function insertMarkdownFrontMatter(view: EditorView): boolean {
  if (!editable(view)) return false;
  const existing = getMarkdownFrontMatterEndLine(view.state.doc);
  view.dispatch(existing ? { selection: EditorSelection.cursor(view.state.doc.line(2).from), scrollIntoView: true }
    : { changes: { from: 0, insert: "---\n\n---\n\n" }, selection: EditorSelection.cursor(4),
      scrollIntoView: true, userEvent: "input.markdown.metadata" });
  return true;
}
export function insertMarkdownCallout(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to).split("\n").map(line => `> ${line}`).join("\n");
  return insertBlock(view, `> [!NOTE]\n${text}`, 12);
}
