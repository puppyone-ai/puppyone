import { syntaxTree } from "@codemirror/language";
import { countColumn, type EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type MarkdownTaskLine = {
  from: number;
  to: number;
  depth: number;
  checked: boolean;
  prefixFrom: number;
  prefixTo: number;
  checkboxFrom: number;
  checkboxTo: number;
  content: string;
  contentFrom: number;
  contentTo: number;
};

/** A view of the parser's ListItem, not a second document model. Both commands
 * and presentation use these source ranges; no whitespace-to-depth heuristic. */
export type MarkdownListItem = {
  node: SyntaxNode;
  list: SyntaxNode;
  parents: SyntaxNode[];
  quoted: boolean;
  marker: string;
  markerFrom: number;
  markerTo: number;
  contentFrom: number;
  indentColumns: number;
  contentColumn: number;
  task: MarkdownTaskLine | null;
};

export function markdownAncestor(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === name) return parent;
  return null;
}

export function readMarkdownListItem(state: EditorState, node: SyntaxNode): MarkdownListItem | null {
  const mark = node.name === "ListItem" ? node.getChild("ListMark") : null;
  if (!mark || !node.parent) return null;
  const line = state.doc.lineAt(mark.from);
  const parents: SyntaxNode[] = [];
  for (let parent: SyntaxNode | null = node.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem") parents.unshift(parent);
  }
  const whitespace = /^[\t ]*/.exec(state.sliceDoc(mark.to, line.to))![0];
  const markerTo = mark.to + whitespace.length;
  const taskMark = node.getChild("Task")?.getChild("TaskMarker");
  const contentFrom = taskMark
    ? taskMark.to + /^[\t ]*/.exec(state.sliceDoc(taskMark.to, line.to))![0].length
    : markerTo;
  const task: MarkdownTaskLine | null = taskMark ? {
    from: line.from, to: line.to, depth: parents.length,
    checked: state.sliceDoc(taskMark.from + 1, taskMark.to - 1).toLowerCase() === "x",
    prefixFrom: line.from, prefixTo: contentFrom,
    checkboxFrom: taskMark.from, checkboxTo: taskMark.to,
    content: state.sliceDoc(contentFrom, line.to), contentFrom, contentTo: line.to,
  } : null;
  const markerEndColumn = countColumn(line.text.slice(0, mark.to - line.from), 4);
  const afterColumn = countColumn(line.text.slice(0, markerTo - line.from), 4);
  // CommonMark: 1–4 columns after the marker define the content indent;
  // larger padding starts indented code and uses one structural column.
  const padding = afterColumn - markerEndColumn;
  return {
    node, list: node.parent, parents, quoted: Boolean(markdownAncestor(node, "Blockquote")),
    marker: state.sliceDoc(mark.from, mark.to), markerFrom: mark.from, markerTo, contentFrom,
    indentColumns: countColumn(line.text.slice(0, mark.from - line.from), 4),
    contentColumn: markerEndColumn + (padding >= 1 && padding <= 4 ? padding : 1), task,
  };
}

export function getMarkdownListItemAt(state: EditorState, position: number): MarkdownListItem | null {
  const line = state.doc.lineAt(position);
  const inside = Math.min(line.to, line.from + /^[\t ]*/.exec(line.text)![0].length + 1);
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(inside, -1);
  // Code and other embedded blocks own their contents, even inside a list.
  while (node && node.name !== "ListItem") {
    if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)) return null;
    node = node.parent;
  }
  return node ? readMarkdownListItem(state, node) : null;
}

export function getMarkdownTaskLine(state: EditorState, position: number): MarkdownTaskLine | null {
  const item = getMarkdownListItemAt(state, position);
  return item && !item.quoted && item.task?.from === state.doc.lineAt(position).from ? item.task : null;
}

/** Lexical recognition is only for unfinished user input. It never establishes
 * list ownership, depth, checkbox validity, or preview decorations. */
export function getMarkdownListInputPrefix(text: string): string | null {
  return /^[\t ]*(?:[-*+]|\d{1,9}[.)])(?:[\t ]+(?:\[(?:[ xX](?:\][\t ]*)?)?)?|$)/.exec(text)?.[0] ?? null;
}
