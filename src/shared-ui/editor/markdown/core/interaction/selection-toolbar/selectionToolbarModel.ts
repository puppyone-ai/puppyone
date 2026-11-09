import { EditorSelection, type EditorState, type ChangeSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { getInlineFormatCoverage, type MarkdownInlineFormatKind } from "../../syntax/markdownElements";
import { getMarkdownFrontMatterEndLine } from "../../syntax/markdownFrontMatter";
import { getSelectedLineNumbers } from "../../commands/markdownBlockCommands";
import { runMarkdownCommand } from "../../commands/markdownCommandRegistry";

export const INLINE_ACTIONS = ["strong", "emphasis", "underline", "strike", "inlineCode", "highlight", "link"] as const;
export const BLOCK_ACTIONS = ["paragraph", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "quote", "bulletList", "orderedList", "taskList"] as const;
export type SelectionBlockType = typeof BLOCK_ACTIONS[number];
const BLOCKED = /^(?:FencedCode|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock|BlockMath|Table)$/;

export function canFormatSelection(state: EditorState): boolean {
  const selection = state.selection.main;
  if (state.readOnly || selection.empty || state.selection.ranges.length !== 1) return false;
  const metadataEnd = getMarkdownFrontMatterEndLine(state.doc);
  if (metadataEnd !== null && selection.from <= state.doc.line(metadataEnd).to) return false;
  let blocked = false;
  syntaxTree(state).iterate({ from: selection.from, to: selection.to,
    enter(node) {
      if (node.to <= selection.from || node.from >= selection.to) return false;
      if (BLOCKED.test(node.name)) blocked = true;
      return !blocked;
    },
  });
  return !blocked;
}

export function selectionBlockType(state: EditorState): SelectionBlockType {
  let node = syntaxTree(state).resolveInner(state.selection.main.from, 1);
  while (node.parent) {
    if (node.name === "SetextHeading1") return "heading1";
    if (node.name === "SetextHeading2") return "heading2";
    node = node.parent;
  }
  const text = state.doc.lineAt(state.selection.main.from).text;
  const heading = /^ {0,3}(#{1,6})\s/.exec(text);
  if (heading) return `heading${heading[1].length}` as SelectionBlockType;
  if (/^\s*[-+*]\s+\[[ xX]\]\s/.test(text)) return "taskList";
  if (/^\s*[-+*]\s/.test(text)) return "bulletList";
  if (/^\s*\d+[.)]\s/.test(text)) return "orderedList";
  if (/^\s*>\s?/.test(text)) return "quote";
  return "paragraph";
}

export function selectionFormatActive(state: EditorState, command: string): boolean {
  if (!["strong", "emphasis", "underline", "strike", "inlineCode", "highlight"].includes(command)) return false;
  const { from, to } = state.selection.main;
  return getInlineFormatCoverage(state, from, to, command as MarkdownInlineFormatKind).formats.length > 0;
}

/** Inline delimiters cannot span separate Markdown blocks. */
export function canFormatInlineSelection(state: EditorState): boolean {
  const { from, to } = state.selection.main;
  let node = syntaxTree(state).resolveInner(from, 1);
  for (;;) {
    if (/^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12]|Task)$/.test(node.name)) {
      const underline = node.name.startsWith("SetextHeading") ? node.getChild("HeaderMark") : null;
      const contentEnd = underline ? state.doc.lineAt(underline.from).from - 1 : node.to;
      return from >= linePrefixEnd(state, state.doc.lineAt(from).number) && to <= contentEnd;
    }
    if (!node.parent) return false;
    node = node.parent;
  }
}

/** Only parser-owned block markers are removed; literal `[x]` remains text. */
function linePrefixEnd(state: EditorState, number: number): number {
  const line = state.doc.line(number);
  let end = line.from + /^[\t ]*/.exec(line.text)![0].length;
  syntaxTree(state).iterate({ from: line.from, to: line.to, enter(node) {
    if (!["HeaderMark", "ListMark", "TaskMarker", "QuoteMark"].includes(node.name)) return;
    if (node.from < end || state.sliceDoc(end, node.from).trim()) return;
    end = node.to + /^[\t ]*/.exec(state.sliceDoc(node.to, line.to))![0].length;
  } });
  return end;
}

function headingSuffixes(state: EditorState, lines: Set<number>): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const selection = state.selection.main;
  syntaxTree(state).iterate({ from: selection.from, to: selection.to, enter(node) {
    if (node.to <= selection.from || node.from >= selection.to) return false;
    if (!/^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) return;
    const marks = node.node.getChildren("HeaderMark");
    const last = marks.at(-1);
    if (!last) return;
    const line = state.doc.lineAt(last.from);
    if (node.name.startsWith("Setext")) {
      lines.delete(line.number);
      lines.add(state.doc.lineAt(node.from).number);
      changes.push({ from: line.from - 1, to: line.to, insert: "" });
    } else if (marks.length > 1) {
      let from = last.from;
      const prefix = linePrefixEnd(state, line.number);
      while (from > prefix && /[\t ]/.test(state.sliceDoc(from - 1, from))) from--;
      changes.push({ from, to: line.to, insert: "" });
    }
    return false;
  } });
  return changes;
}

/** Block choices replace the selected line prefixes in one undoable transaction. */
function setBlockType(view: EditorView, type: SelectionBlockType): boolean {
  const { state } = view;
  const lines = new Set(getSelectedLineNumbers(state).filter(number => state.doc.line(number).from < state.selection.main.to && state.doc.line(number).text.trim()));
  const suffixes = headingSuffixes(state, lines);
  const changes: ChangeSpec[] = [...lines].sort((a, b) => a - b).map((number, index) => {
    const line = state.doc.line(number);
    const prefixEnd = linePrefixEnd(state, number);
    const indent = /^ */.exec(line.text)![0];
    const markers: Partial<Record<SelectionBlockType, string>> = { bulletList: "- ", orderedList: `${index + 1}. `, taskList: "- [ ] ", quote: "> " };
    const marker = type.startsWith("heading") ? "#".repeat(Number(type.at(-1))) + " " : (markers[type] ?? "");
    return { from: line.from, to: prefixEnd, insert: (type.startsWith("heading") ? "" : indent) + marker };
  });
  const changeSet = state.changes([...changes, ...suffixes]);
  const selection = state.selection.main;
  view.dispatch({ changes: changeSet,
    selection: EditorSelection.range(changeSet.mapPos(selection.anchor, 1), changeSet.mapPos(selection.head, 1)),
    annotations: isolateHistory.of("full"), userEvent: "input.markdown.block" });
  return true;
}

export function applySelectionToolbarCommand(view: EditorView, command: string): boolean {
  if (!canFormatSelection(view.state)) return false;
  const block = BLOCK_ACTIONS.includes(command as SelectionBlockType);
  if (!block && !canFormatInlineSelection(view.state)) return false;
  view.dispatch({ annotations: isolateHistory.of("before") });
  const applied = block
    ? setBlockType(view, command as SelectionBlockType) : runMarkdownCommand(view, command);
  view.dispatch({ annotations: isolateHistory.of("after") });
  if (applied) view.focus();
  return applied;
}

export type ToolbarRect = { left: number; right: number; top: number; bottom: number };
export function placeSelectionToolbar(anchor: ToolbarRect, pane: ToolbarRect, width: number, height: number) {
  const left = Math.max(pane.left + 6, Math.min((anchor.left + anchor.right - width) / 2, pane.right - width - 6));
  const above = anchor.top - height - 8;
  const top = above >= pane.top + 6 ? above : Math.min(anchor.bottom + 8, pane.bottom - height - 6);
  return { left, top: Math.max(pane.top + 6, top) };
}
