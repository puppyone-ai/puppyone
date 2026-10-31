import { countColumn, EditorSelection, EditorState, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { getMarkdownListItemAt, readMarkdownListItem, type MarkdownListItem } from "../syntax/markdownListStructure";

export function setMarkdownHeadingLevel(level: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.readOnly) return false;

    const changes: ChangeSpec[] = [];
    const touchedLines = new Set<number>();
    const marker = level > 0 ? `${"#".repeat(level)} ` : "";

    for (const range of state.selection.ranges) {
      const fromLine = state.doc.lineAt(range.from);
      const toLine = state.doc.lineAt(range.to);
      for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
        if (touchedLines.has(lineNumber)) continue;
        touchedLines.add(lineNumber);

        const line = state.doc.line(lineNumber);
        const headingMatch = /^(#{1,6})(\s|$)/.exec(line.text);
        const replaceTo = line.from + (headingMatch?.[0].length ?? 0);
        if (state.sliceDoc(line.from, replaceTo) === marker) continue;
        changes.push({ from: line.from, to: replaceTo, insert: marker });
      }
    }

    if (changes.length > 0) view.dispatch({ changes });
    return true;
  };
}

export function toggleMarkdownList(kind: "bullet" | "ordered" | "task") {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.readOnly) return false;

    const lines = getSelectedLineNumbers(state);
    const items = lines.map(number => {
      const line = state.doc.line(number);
      const item = getMarkdownListItemAt(state, line.from);
      return item && !item.quoted && state.doc.lineAt(item.markerFrom).from === line.from ? item : null;
    });
    const allMatching = items.every(item => item && (kind === "task" ? item.task
      : !item.task && item.list.name === (kind === "ordered" ? "OrderedList" : "BulletList")));
    const changes: ChangeSpec[] = [];
    lines.forEach((lineNumber, index) => {
      const line = state.doc.line(lineNumber);
      const item = items[index];
      const markerFrom = item?.markerFrom ?? line.from + /^[\t ]*/.exec(line.text)![0].length;
      const markerTo = item?.contentFrom ?? markerFrom;
      const marker = allMatching ? "" : kind === "ordered" ? `${index + 1}. ` : kind === "task" ? "- [ ] " : "- ";
      changes.push({ from: markerFrom, to: markerTo, insert: marker });
    });

    if (changes.length === 0) return false;
    view.dispatch({ changes });
    return true;
  };
}

export function toggleMarkdownQuote(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;

  const lines = getSelectedLineNumbers(state);
  const allQuoted = lines.every((lineNumber) => /^\s*>\s?/.test(state.doc.line(lineNumber).text));
  const changes: ChangeSpec[] = [];

  for (const lineNumber of lines) {
    const line = state.doc.line(lineNumber);
    const leadingWhitespace = /^\s*/.exec(line.text)?.[0] ?? "";
    if (allQuoted) {
      const quoteMatch = /^(\s*)>\s?/.exec(line.text);
      if (quoteMatch) changes.push({ from: line.from + quoteMatch[1].length, to: line.from + quoteMatch[0].length, insert: "" });
      continue;
    }
    changes.push({ from: line.from + leadingWhitespace.length, insert: "> " });
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}

/** Continue the same parsed item, changing source and numbering atomically. */
export function continueMarkdownListItem(view: EditorView, item: MarkdownListItem): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.from);
  const isFirstLine = state.doc.lineAt(item.markerFrom).from === line.from;
  if (isFirstLine && selection.from < item.contentFrom) return false;
  if (isFirstLine && selection.from === line.to && !state.sliceDoc(item.contentFrom, line.to).trim()) {
    if (item.parents.length) return outdentMarkdownListItem(view);
    view.dispatch({ changes: { from: line.from, to: item.contentFrom, insert: "" },
      selection: EditorSelection.cursor(line.from), userEvent: "input" });
    return true;
  }

  const ordered = item.list.name === "OrderedList";
  const nextNumber = ordered ? Number.parseInt(item.marker, 10) + 1 : 0;
  const marker = ordered ? `${nextNumber}${item.marker.slice(-1)}` : item.marker;
  const prefix = isFirstLine
    ? `${state.sliceDoc(line.from, item.markerFrom)}${marker} ${item.task ? "[ ] " : ""}`
    : " ".repeat(item.contentColumn);
  const changes: ChangeSpec[] = [{ from: selection.from, insert: `\n${prefix}` }];
  // Continue a sequential ordered list locally, preserving its starting number.
  // Deliberately repeated/custom numbers and unrelated lists are untouched.
  if (isFirstLine && ordered) {
    let expected = nextNumber;
    for (let node = item.node.nextSibling; node; node = node.nextSibling) {
      const sibling = readMarkdownListItem(state, node);
      if (!sibling || Number.parseInt(sibling.marker, 10) !== expected) break;
      changes.push({ from: sibling.markerFrom, to: sibling.markerFrom + sibling.marker.length - 1, insert: String(++expected) });
    }
  }
  view.dispatch({ changes, selection: EditorSelection.cursor(selection.from + 1 + prefix.length), userEvent: "input" });
  return true;
}

export function indentMarkdownListItem(view: EditorView): boolean {
  return adjustMarkdownListIndent(view, 1);
}

export function outdentMarkdownListItem(view: EditorView): boolean {
  return adjustMarkdownListIndent(view, -1);
}

function adjustMarkdownListIndent(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const selected = new Map<number, MarkdownListItem>();
  for (const number of getSelectedLineNumbers(state)) {
    const item = getMarkdownListItemAt(state, state.doc.line(number).from);
    if (item && !item.quoted) selected.set(item.node.from, item);
  }
  const items = [...selected.values()].filter(item => !item.parents.some(parent => selected.has(parent.from)));
  const changes: ChangeSpec[] = [];
  for (const item of items) {
    let targetColumn: number;
    if (direction < 0) {
      const parent = item.parents.at(-1);
      if (!parent) continue;
      targetColumn = readMarkdownListItem(state, parent)!.indentColumns;
    } else {
      let previous = item.node.prevSibling;
      // A selected sibling group moves together under its preceding item.
      while (previous && selected.has(previous.from)) previous = previous.prevSibling;
      if (!previous && /^(BulletList|OrderedList)$/.test(item.list.prevSibling?.name ?? "")) {
        previous = item.list.prevSibling!.lastChild;
      }
      const parent = previous ? readMarkdownListItem(state, previous) : null;
      if (!parent) continue;
      targetColumn = parent.contentColumn;
    }
    const delta = targetColumn - item.indentColumns;
    if (!delta) continue;
    // Move the whole item, including wrapped source lines and descendants.
    for (let n = state.doc.lineAt(item.node.from).number; n <= state.doc.lineAt(item.node.to).number; n++) {
      const line = state.doc.line(n);
      if (!line.text.trim()) continue;
      const whitespace = /^[\t ]*/.exec(line.text)![0];
      changes.push({ from: line.from, to: line.from + whitespace.length,
        insert: " ".repeat(Math.max(0, countColumn(whitespace, 4) + delta)) });
    }
  }
  // A list with no valid parent/sibling still owns Tab. Returning false would
  // fall through to indentWithTab and turn a first child into code/continuation.
  if (!changes.length) return selected.size > 0;
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
}

export function getSelectedLineNumbers(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
      lines.add(lineNumber);
    }
  }
  return [...lines].sort((left, right) => left - right);
}

export type OrderedListRenumberScope = Readonly<{
  from: number;
  to: number;
  indent?: string;
}>;

export function getOrderedListRenumberChanges(
  state: EditorState,
  scope?: OrderedListRenumberScope,
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  syntaxTree(state).iterate({ from: scope?.from, to: scope?.to, enter(ref) {
    const list = ref.node;
    if (list.name !== "OrderedList") return;
    const firstLine = state.doc.lineAt(list.from);
    if (scope?.indent !== undefined && /^[\t ]*/.exec(firstLine.text)![0] !== scope.indent) return;
    let number = 0;
    for (let node = list.firstChild; node; node = node.nextSibling) {
      const item = readMarkdownListItem(state, node);
      if (!item) continue;
      number++;
      const marker = item.marker.slice(0, -1);
      if (marker !== String(number)) changes.push({ from: item.markerFrom, to: item.markerFrom + marker.length, insert: String(number) });
    }
  } });
  return changes;
}
