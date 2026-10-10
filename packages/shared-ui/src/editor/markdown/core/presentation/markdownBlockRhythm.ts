import { syntaxTree } from "@codemirror/language";
import type { EditorState, Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const orderedMarkerColumns = new WeakMap<object, Map<string, number>>();
const markerDiagnostics = { itemsScanned: 0 };
export const getMarkdownMarkerDiagnostics = () => ({ ...markerDiagnostics });
export const resetMarkdownMarkerDiagnostics = () => { markerDiagnostics.itemsScanned = 0; };

function markerColumnsFor(state: EditorState) {
  let columns = orderedMarkerColumns.get(state.doc);
  if (!columns) { columns = new Map(); orderedMarkerColumns.set(state.doc, columns); }
  return columns;
}
const listKey = (list: SyntaxNode) => `${list.from}:${list.to}`;

export type MarkdownLineRhythm = {
  classes: Set<string>;
  list?: { depth: number; marker: string; columns: number; parentColumns: number[]; prefixTo: number };
};

/** Semantic boundaries only. Theme files own every visual spacing value.
 * The caller owns a document StateField, so these height-affecting classes are
 * available before CodeMirror computes its viewport, including local patches.
 */
export function getMarkdownBlockRhythm(state: EditorState, from: number, to: number) {
  const lines = new Map<number, MarkdownLineRhythm>();
  const orderedColumns = markerColumnsFor(state);
  const add = (position: number, ...classes: string[]) => {
    const line = state.doc.lineAt(position);
    if (line.from < from || line.from > to) return undefined;
    let rhythm = lines.get(line.from);
    if (!rhythm) { rhythm = { classes: new Set() }; lines.set(line.from, rhythm); }
    for (const name of classes) rhythm.classes.add(name);
    return rhythm;
  };
  const context = { state, from, to, add, orderedColumns };
  syntaxTree(state).iterate({ from, to, enter(ref) {
    const node = ref.node;
    if (node.name === "Paragraph") {
      addParagraphRhythm(node, context);
    } else if (node.name === "ListItem" && !ancestor(node, "Blockquote")) {
      add(node.from, "cm-md-list-item-start");
      add(node.to, "cm-md-list-item-end");
    } else if ((node.name === "BulletList" || node.name === "OrderedList") && !ancestor(node, "ListItem") && !ancestor(node, "Blockquote")) {
      add(node.from, "cm-md-list-start");
      add(node.to, "cm-md-list-end");
    }
  } });
  return lines;
}

type AddRhythm = (position: number, ...classes: string[]) => MarkdownLineRhythm | undefined;
type RhythmContext = { state: EditorState; from: number; to: number; add: AddRhythm; orderedColumns: Map<string, number> };

function addParagraphRhythm(node: SyntaxNode, context: RhythmContext) {
  const { add } = context;
  const item = ancestor(node, "ListItem");
  // Quoted lists retain source markers through their existing adapter.
  if (item && ancestor(item, "Blockquote")) return;
  if (!item) {
    add(node.from, "cm-md-paragraph-start");
    add(node.to, "cm-md-paragraph-end");
    return;
  }
  const paragraphs = item.getChildren("Paragraph");
  if (paragraphs[0]?.from !== node.from) add(node.from, "cm-md-paragraph-start");
  if (paragraphs.at(-1)?.from !== node.from) add(node.to, "cm-md-paragraph-end");
  addListParagraphRhythm(node, item, context);
}

function addListParagraphRhythm(node: SyntaxNode, item: SyntaxNode, context: RhythmContext) {
  const { state, from, to, add, orderedColumns } = context;
  const mark = item.getChild("ListMark");
  if (!mark) return;
  const marker = state.sliceDoc(mark.from, mark.to);
  const list = item.parent!;
  const columns = listMarkerColumns(list, orderedColumns);
  const parentColumns: number[] = [];
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem" && parent.parent) parentColumns.unshift(listMarkerColumns(parent.parent, orderedColumns));
  }
  const depth = parentColumns.length;
  const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to);
  for (let number = Math.max(first.number, state.doc.lineAt(from).number); number <= Math.min(last.number, state.doc.lineAt(to).number); number++) {
    const line = state.doc.line(number);
    const start = line.from === state.doc.lineAt(item.from).from;
    const rhythm = add(line.from, "cm-md-list-line", ...(list.name === "OrderedList" ? ["cm-md-ordered-list-line"] : []),
      ...(depth ? ["cm-md-nested-list-line"] : []), ...(start ? [] : ["cm-md-list-continuation"]));
    if (!rhythm) continue;
    const pattern = start ? /^(\s*)(?:[-*+]|\d+[.)])\s+/ : /^\s*/;
    const prefix = pattern.exec(line.text)?.[0] ?? "";
    const visibleMarker = /^\d/.test(marker) ? marker : "•";
    rhythm.list = { depth, columns, parentColumns, marker: start ? visibleMarker : "", prefixTo: line.from + prefix.length };
  }
}

function ancestor(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === name) return parent;
  return null;
}

function widestOrderedMarker(list: SyntaxNode): number {
  let columns = 0;
  for (let item = list.firstChild; item; item = item.nextSibling) {
    markerDiagnostics.itemsScanned += 1;
    const mark = item.getChild("ListMark");
    if (mark) columns = Math.max(columns, mark.to - mark.from);
  }
  return columns;
}

function listMarkerColumns(list: SyntaxNode, cache: Map<string, number>) {
  if (list.name !== "OrderedList") return 0;
  const columns = cache.get(listKey(list)) ?? widestOrderedMarker(list);
  cache.set(listKey(list), columns);
  return columns;
}

/** Structural prefix edits can change descendant depth or a shared number
 * column. Expand only those edits, preserving range-local ordinary typing. */
export function getChangedMarkdownRhythmRanges(transaction: Transaction) {
  const ranges: { from: number; to: number }[] = [];
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const before = transaction.startState.doc.lineAt(fromA), after = transaction.state.doc.lineAt(fromB);
    const prefix = (text: string) => /^(?:[\t ]*(?:[-*+]|\d+[.)])(?:[\t ]+|$)|[\t ]*)/.exec(text)?.[0];
    const changedLineBreaks = /[\r\n]/.test(transaction.startState.sliceDoc(fromA, toA)) || /[\r\n]/.test(transaction.state.sliceDoc(fromB, toB));
    if (prefix(before.text) === prefix(after.text) && !changedLineBreaks) {
      inheritOrderedColumns(transaction, { fromA, toA, fromB, toB });
      return;
    }
    for (const [state, position, old] of [[transaction.startState, fromA, true], [transaction.state, fromB, false]] as const) {
      const insideLine = Math.min(state.doc.lineAt(position).to, position + 1);
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(insideLine, -1);
      while (node && node.name !== "ListItem" && node.name !== "OrderedList") node = node.parent;
      if (!node) continue;
      const owner = node.parent?.name === "OrderedList" ? node.parent : node;
      ranges.push({ from: old ? transaction.changes.mapPos(owner.from, -1) : owner.from,
        to: old ? transaction.changes.mapPos(owner.to, 1) : owner.to });
    }
  });
  return ranges;
}

/** A body edit does not change numbering. Reuse its containing list's width
 * only when the mapped list range matches and no line break was inserted or
 * deleted; structural edits and background parse progress recompute it. */
function inheritOrderedColumns(transaction: Transaction, change: { fromA: number; toA: number; fromB: number; toB: number }) {
  const { startState: before, state: after, changes } = transaction;
  if (/[\r\n]/.test(before.sliceDoc(change.fromA, change.toA)) || /[\r\n]/.test(after.sliceDoc(change.fromB, change.toB))) return;
  let previous = ancestor(syntaxTree(before).resolveInner(change.fromA, -1), "OrderedList");
  let next = ancestor(syntaxTree(after).resolveInner(change.fromB, -1), "OrderedList");
  while (previous && next) {
    if (changes.mapPos(previous.from, -1) !== next.from || changes.mapPos(previous.to, 1) !== next.to) return;
    const columns = markerColumnsFor(before).get(listKey(previous));
    if (columns !== undefined) markerColumnsFor(after).set(listKey(next), columns);
    previous = ancestor(previous, "OrderedList"); next = ancestor(next, "OrderedList");
  }
}
