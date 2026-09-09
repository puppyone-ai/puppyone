import { ChangeSet, EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getMarkdownElements,
  getMarkdownElementsInRange,
  type MarkdownElement,
  type MarkdownMarkerRange,
} from "../syntax/markdownElements";
import { serializeMarkdownCodeFence } from "../syntax/markdownCodeFence";
import {
  indentMarkdownListItem,
  outdentMarkdownListItem,
  setMarkdownHeadingLevel,
  toggleMarkdownList,
  toggleMarkdownQuote,
} from "./markdownBlockCommands";
import {
  applyMarkdownFormatCommand,
  toggleMarkdownInline,
  wrapMarkdownLink,
} from "./markdownInlineCommands";

export const MARKDOWN_EDITOR_COMMANDS = [
  "paragraph",
  "heading-1",
  "heading-2",
  "heading-3",
  "heading-4",
  "heading-5",
  "heading-6",
  "bullet-list",
  "ordered-list",
  "task-list",
  "quote",
  "code-block",
  "math-block",
  "indent",
  "outdent",
  "strong",
  "emphasis",
  "underline",
  "strike",
  "highlight",
  "inline-code",
  "inline-math",
  "link",
  "clear-format",
] as const;

export type MarkdownEditorCommand = typeof MARKDOWN_EDITOR_COMMANDS[number];

const markdownEditorCommandSet = new Set<string>(MARKDOWN_EDITOR_COMMANDS);

export function isMarkdownEditorCommand(value: unknown): value is MarkdownEditorCommand {
  return typeof value === "string" && markdownEditorCommandSet.has(value);
}

export function applyMarkdownEditorCommand(
  view: EditorView,
  command: MarkdownEditorCommand,
): boolean {
  if (view.state.readOnly) return false;

  if (command === "paragraph") return setMarkdownHeadingLevel(0)(view);
  if (command.startsWith("heading-")) {
    const level = Number.parseInt(command.slice("heading-".length), 10) as 1 | 2 | 3 | 4 | 5 | 6;
    return setMarkdownHeadingLevel(level)(view);
  }
  if (command === "bullet-list") return toggleMarkdownList("bullet")(view);
  if (command === "ordered-list") return toggleMarkdownList("ordered")(view);
  if (command === "task-list") return toggleMarkdownList("task")(view);
  if (command === "quote") return toggleMarkdownQuote(view);
  if (command === "code-block") return toggleMarkdownCodeBlock(view);
  if (command === "math-block") return toggleMarkdownMathBlock(view);
  if (command === "indent") return indentMarkdownListItem(view);
  if (command === "outdent") return outdentMarkdownListItem(view);
  if (
    command === "strong"
    || command === "emphasis"
    || command === "underline"
    || command === "strike"
    || command === "highlight"
  ) {
    return applyMarkdownFormatCommand(view, command);
  }
  if (command === "inline-code") return toggleMarkdownInline("`")(view);
  if (command === "inline-math") return toggleMarkdownInline("$")(view);
  if (command === "link") return wrapMarkdownLink(view);
  if (command === "clear-format") return clearMarkdownInlineFormatting(view);
  return false;
}

function toggleMarkdownMathBlock(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  const existingBlock = getMarkdownElements(state).find((element) => (
    element.kind === "mathBlock"
    && selection.from >= element.from
    && selection.to <= element.to
  ));
  if (existingBlock && unwrapMarkdownMathBlock(view, existingBlock)) return true;

  const fromLine = state.doc.lineAt(selection.from);
  const toLine = state.doc.lineAt(selection.to);
  const sourceFrom = fromLine.from;
  const sourceTo = toLine.to;
  const source = state.sliceDoc(sourceFrom, sourceTo);
  const opening = "$$\n";
  const closing = "\n$$";

  const previousLine = fromLine.number > 1 ? state.doc.line(fromLine.number - 1) : null;
  const nextLine = toLine.number < state.doc.lines ? state.doc.line(toLine.number + 1) : null;
  if (
    selection.from === sourceFrom
    && selection.to === sourceTo
    && previousLine
    && previousLine.text === "$$"
    && nextLine?.text === "$$"
  ) {
    view.dispatch({
      changes: { from: previousLine.from, to: nextLine.to, insert: source },
      selection: EditorSelection.range(previousLine.from, previousLine.from + source.length),
    });
    return true;
  }

  const firstLineBreak = source.indexOf("\n");
  const lastLineBreak = source.lastIndexOf("\n");
  const sourceOpening = firstLineBreak >= 0 ? source.slice(0, firstLineBreak) : source;
  const sourceClosing = lastLineBreak >= 0 ? source.slice(lastLineBreak + 1) : "";
  if (
    firstLineBreak >= 0
    && lastLineBreak > firstLineBreak
    && sourceOpening === "$$"
    && sourceClosing === "$$"
  ) {
    const inner = source.slice(firstLineBreak + 1, lastLineBreak);
    view.dispatch({
      changes: { from: sourceFrom, to: sourceTo, insert: inner },
      selection: EditorSelection.range(sourceFrom, sourceFrom + inner.length),
    });
    return true;
  }

  const wrapped = `${opening}${source}${closing}`;
  view.dispatch({
    changes: { from: sourceFrom, to: sourceTo, insert: wrapped },
    selection: selection.empty
      ? EditorSelection.cursor(sourceFrom + opening.length)
      : EditorSelection.range(sourceFrom + opening.length, sourceFrom + opening.length + source.length),
  });
  return true;
}

function toggleMarkdownCodeBlock(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const selection = state.selection.main;
  const existingBlock = getMarkdownElements(state).find((element) => (
    element.kind === "fence"
    && element.blockData?.kind === "fence"
    && selection.from >= element.from
    && selection.to <= element.to
  ));
  if (existingBlock?.blockData?.kind === "fence") {
    const source = state.sliceDoc(existingBlock.from, existingBlock.to);
    const firstLineBreak = source.indexOf("\n");
    const contentFrom = firstLineBreak >= 0
      ? existingBlock.from + firstLineBreak + 1
      : existingBlock.from;
    const code = existingBlock.blockData.code;
    const mapPosition = (position: number) => (
      existingBlock.from + Math.max(0, Math.min(code.length, position - contentFrom))
    );
    view.dispatch({
      changes: { from: existingBlock.from, to: existingBlock.to, insert: code },
      selection: selection.empty
        ? EditorSelection.cursor(mapPosition(selection.from))
        : EditorSelection.range(mapPosition(selection.from), mapPosition(selection.to)),
    });
    return true;
  }

  const fromLine = state.doc.lineAt(selection.from);
  const toLine = state.doc.lineAt(selection.to);
  const sourceFrom = fromLine.from;
  const sourceTo = toLine.to;
  const source = state.sliceDoc(sourceFrom, sourceTo);
  const wrapped = serializeMarkdownCodeFence("", source);
  const contentOffset = wrapped.indexOf("\n") + 1;
  view.dispatch({
    changes: { from: sourceFrom, to: sourceTo, insert: wrapped },
    selection: selection.empty
      ? EditorSelection.cursor(sourceFrom + contentOffset)
      : EditorSelection.range(
          sourceFrom + contentOffset,
          sourceFrom + contentOffset + source.length,
        ),
  });
  return true;
}

function unwrapMarkdownMathBlock(view: EditorView, element: MarkdownElement): boolean {
  if (
    element.kind !== "mathBlock"
    || element.blockData?.kind !== "mathBlock"
    || !element.contentRange
  ) return false;

  const selection = view.state.selection.main;
  const inner = element.blockData.source;
  const contentFrom = element.contentRange.from;
  const mapPosition = (position: number) => (
    element.from + Math.max(0, Math.min(inner.length, position - contentFrom))
  );
  view.dispatch({
    changes: { from: element.from, to: element.to, insert: inner },
    selection: selection.empty
      ? EditorSelection.cursor(mapPosition(selection.from))
      : EditorSelection.range(mapPosition(selection.from), mapPosition(selection.to)),
  });
  return true;
}

function clearMarkdownInlineFormatting(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const selection = state.selection.main;
  if (selection.empty) return false;

  const elements = getMarkdownElementsInRange(state, selection.from, selection.to);
  const ranges = mergeRanges(elements.flatMap((element) => (
    getClearFormattingRanges(element, selection.from, selection.to)
  )));
  if (ranges.length === 0) return false;

  const changeSet = ChangeSet.of(
    ranges.map((range) => ({ from: range.from, to: range.to, insert: "" })),
    state.doc.length,
  );
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.range(
      changeSet.mapPos(selection.from, 1),
      changeSet.mapPos(selection.to, -1),
    ),
  });
  return true;
}

function getClearFormattingRanges(
  element: MarkdownElement,
  selectionFrom: number,
  selectionTo: number,
): MarkdownMarkerRange[] {
  if (!isClearableInlineElement(element)) return [];
  const content = element.contentRange;
  const elementInsideSelection = element.from >= selectionFrom && element.to <= selectionTo;
  const selectionInsideContent = Boolean(
    content && selectionFrom >= content.from && selectionTo <= content.to,
  );
  if (!elementInsideSelection && !selectionInsideContent) return [];

  if ((element.kind === "link" || element.kind === "inlineHtml") && content) {
    return [
      { from: element.from, to: content.from },
      { from: content.to, to: element.to },
    ].filter((range) => range.from < range.to);
  }
  return element.markerRanges;
}

function isClearableInlineElement(element: MarkdownElement): boolean {
  if (
    element.kind === "emphasis"
    || element.kind === "inlineCode"
    || element.kind === "link"
    || element.kind === "mathInline"
    || element.kind === "strike"
    || element.kind === "strong"
  ) return true;
  return element.kind === "inlineHtml"
    && element.inlineHtml.status === "complete"
    && (element.inlineHtml.tagName === "u"
      || element.inlineHtml.tagName === "strong"
      || element.inlineHtml.tagName === "em"
      || element.inlineHtml.tagName === "mark");
}

function mergeRanges(ranges: readonly MarkdownMarkerRange[]): MarkdownMarkerRange[] {
  const sorted = ranges
    .filter((range) => range.from < range.to)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: MarkdownMarkerRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
