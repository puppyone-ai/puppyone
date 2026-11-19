import { syntaxTree } from "@codemirror/language";
import type { EditorState, Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { getMarkdownListItemAt, markdownAncestor as ancestor, readMarkdownListItem, type MarkdownListItem } from "../syntax/markdownListStructure";

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
  list?: { depth: number; marker: string; columns: number; parentColumns: number[]; prefixTo: number; sourceIndentTo: number };
};

/** Semantic boundaries only. Theme files own every visual spacing value.
 * The caller owns a document StateField, so these height-affecting classes are
 * available before CodeMirror computes its viewport, including local patches.
 */
export function getMarkdownBlockRhythm(state: EditorState, from: number, to: number, sourceLineFrom?: number) {
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
  const context = { state, from, to, add, orderedColumns, sourceLineFrom };
  syntaxTree(state).iterate({ from, to, enter(ref) {
    const node = ref.node;
    if (node.name === "Paragraph") {
      addParagraphRhythm(node, context);
    } else if (node.name === "ListItem" && !ancestor(node, "Blockquote")) {
      add(node.from, "cm-md-list-item-start");
      add(node.to, "cm-md-list-item-end");
      const item = readMarkdownListItem(state, node);
      if (item) addListItemRhythm(item, context);
    } else if ((node.name === "BulletList" || node.name === "OrderedList") && !ancestor(node, "ListItem") && !ancestor(node, "Blockquote")) {
      add(node.from, "cm-md-list-start");
      add(node.to, "cm-md-list-end");
    }
  } });
  return lines;
}

type AddRhythm = (position: number, ...classes: string[]) => MarkdownLineRhythm | undefined;
type RhythmContext = { state: EditorState; from: number; to: number; add: AddRhythm; orderedColumns: Map<string, number>; sourceLineFrom?: number };

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
}

function addListItemRhythm(item: MarkdownListItem, context: RhythmContext) {
  const { state, from, to, add, orderedColumns } = context;
  const { list, marker } = item;
  const columns = listMarkerColumns(list, orderedColumns);
  const parentColumns = item.parents.map(parent => listMarkerColumns(parent.parent!, orderedColumns));
  const depth = parentColumns.length;
  // The item owns its marker line and every direct text block. Nested items
  // project themselves; code/widgets retain their existing block adapters.
  const spans = [{ from: item.node.from, to: state.doc.lineAt(item.node.from).to }];
  for (let block = item.node.firstChild; block; block = block.nextSibling) {
    if (block.name === "Paragraph" || block.name === "Task" || /^(ATXHeading|SetextHeading)/.test(block.name)) spans.push(block);
  }
  for (const span of spans) {
    const first = state.doc.lineAt(span.from), last = state.doc.lineAt(span.to);
    for (let number = Math.max(first.number, state.doc.lineAt(from).number); number <= Math.min(last.number, state.doc.lineAt(to).number); number++) {
      const line = state.doc.line(number);
      const existing = add(line.from);
      // `- - text` has two ListItems on one source line. Editing exposes both
      // literal markers from the outer rail, never hides a typed parent marker.
      if (line.from === context.sourceLineFrom && existing?.list) continue;
      const start = line.from === state.doc.lineAt(item.node.from).from;
      const rhythm = add(line.from, "cm-md-list-line", ...(list.name === "OrderedList" ? ["cm-md-ordered-list-line"] : []),
        ...(depth ? ["cm-md-nested-list-line"] : []), ...(start ? [] : ["cm-md-list-continuation"]),
        ...(item.task ? ["cm-md-task-line", ...(item.task.checked ? ["cm-md-task-checked"] : [])] : []));
      if (!rhythm) continue;
      const sourceIndentTo = start ? item.markerFrom : line.from + /^[\t ]*/.exec(line.text)![0].length;
      const visibleMarker = /^\d/.test(marker) ? marker : "•";
      rhythm.list = { depth, columns, parentColumns, marker: start ? visibleMarker : "",
        prefixTo: start ? item.contentFrom : sourceIndentTo, sourceIndentTo };
    }
  }
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
    const beforeItem = getMarkdownListItemAt(transaction.startState, fromA);
    const afterItem = getMarkdownListItemAt(transaction.state, fromB);
    const changedLineBreaks = /[\r\n]/.test(transaction.startState.sliceDoc(fromA, toA)) || /[\r\n]/.test(transaction.state.sliceDoc(fromB, toB));
    if (listStructureKey(transaction.startState, beforeItem) === listStructureKey(transaction.state, afterItem) && !changedLineBreaks) {
      inheritOrderedColumns(transaction, { fromA, toA, fromB, toB });
      return;
    }
    for (const [item, old] of [[beforeItem, true], [afterItem, false]] as const) {
      if (!item) continue;
      // Marker edits may reparent descendants or resize an ancestor's shared
      // number column. Invalidate that semantic owner, not arbitrary nearby lines.
      const owner = item.parents[0]?.parent ?? item.list;
      ranges.push({ from: old ? transaction.changes.mapPos(owner.from, -1) : owner.from,
        to: old ? transaction.changes.mapPos(owner.to, 1) : owner.to });
    }
  });
  return ranges;
}

function listStructureKey(state: EditorState, item: MarkdownListItem | null): string {
  if (!item) return "";
  const line = state.doc.lineAt(item.node.from);
  const blocks: string[] = [];
  for (let block = item.node.firstChild; block; block = block.nextSibling) blocks.push(block.name);
  return `${item.parents.length}:${item.list.name}:${state.sliceDoc(line.from, item.contentFrom)}:${blocks.join(",")}`;
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
