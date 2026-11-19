import { EditorState, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getLivePreviewFocusState } from "./livePreviewFocus";
import { getMarkdownListInputPrefix } from "../syntax/markdownListStructure";

export type ComposingBlockLine = {
  from: number;
  to: number;
};

/**
 * Tracks the line whose block prefix is currently being typed (e.g. `##` before
 * the trailing space is committed). That line stays in source form so markers
 * are not hidden mid-composition.
 */
export const markdownComposingBlockLineField = StateField.define<ComposingBlockLine | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    if (getLivePreviewFocusState(true, transaction.effects) === false) return null;
    if (transaction.isUserEvent("input.paste") || transaction.isUserEvent("input.drop")) return null;

    let next = value
      ? {
          from: transaction.changes.mapPos(value.from),
          to: transaction.changes.mapPos(value.to),
        }
      : null;

    const selection = transaction.state.selection.main;
    const selectionLine = transaction.state.doc.lineAt(selection.head);
    if (next && selectionLine.from !== next.from) next = null;

    if (
      transaction.docChanged &&
      (transaction.isUserEvent("input.type") ||
        transaction.isUserEvent("delete.backward") ||
        transaction.isUserEvent("delete.forward"))
    ) {
      const composingRange = getComposingBlockPrefixRange(selectionLine.from, selectionLine.text);
      if (composingRange && transactionTouchesRange(transaction, composingRange.from, composingRange.to)) {
        return { from: selectionLine.from, to: selectionLine.to };
      }
    }

    return next;
  },
});

export function isSelectionInComposingBlockLine(state: EditorState, pos: number): boolean {
  const composingLine = state.field(markdownComposingBlockLineField, false);
  return Boolean(composingLine && state.doc.lineAt(pos).from === composingLine.from);
}

export function getComposingBlockLineKey(state: EditorState): string {
  const line = state.field(markdownComposingBlockLineField, false);
  return line ? `${line.from}:${line.to}` : "";
}

function getComposingBlockPrefixRange(lineFrom: number, text: string): { from: number; to: number } | null {
  const listPrefix = getMarkdownListInputPrefix(text);
  if (listPrefix !== null) return { from: lineFrom, to: lineFrom + listPrefix.length };
  const match = /^(#{1,6}\s?|\s*>+\s?|\s{0,3}(?:`{3,}|~{3,})[^\n`]*|\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*|\|.*\|)/.exec(text);
  if (!match) return null;
  return { from: lineFrom, to: lineFrom + match[0].length };
}

function transactionTouchesRange(transaction: Transaction, from: number, to: number): boolean {
  let touches = false;
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (fromB <= to && Math.max(fromB, toB) >= from) touches = true;
  });
  return touches;
}

export const markdownInputCompositionEffect = StateEffect.define<boolean>();

export const markdownInputCompositionExtension = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    dispatchMarkdownInputCompositionEffect(view, true);
    return false;
  },
  compositionend(_event, view) {
    dispatchMarkdownInputCompositionEffect(view, false);
    return false;
  },
});

function dispatchMarkdownInputCompositionEffect(view: EditorView, composing: boolean) {
  queueMicrotask(() => {
    if (!view.dom.isConnected) return;
    if (composing && !view.composing) return;
    view.dispatch({ effects: markdownInputCompositionEffect.of(composing) });
  });
}

export function getInputCompositionState(inputComposing: boolean, effects: readonly StateEffect<unknown>[]): boolean {
  for (const effect of effects) {
    if (effect.is(markdownInputCompositionEffect)) return effect.value;
  }
  return inputComposing;
}
