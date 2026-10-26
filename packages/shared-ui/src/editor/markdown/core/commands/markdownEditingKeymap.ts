import { EditorSelection } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { getMarkdownListItemAt } from "../syntax/markdownListStructure";
import {
  getCollapsedMarkerDeletionUnit,
  getExpandableInlineAtomAtSelection,
} from "../plans/markdownPlanIndex";
import {
  markdownRevealedSourceEffect,
  markdownRevealedSourceField,
} from "../state/revealedSource";
import { isSelectionInComposingBlockLine, markdownComposingBlockLineField } from "../state/composingBlockLine";
import {
  getBlockMarkerAtVisibleStart,
  getMarkdownVisibleLineStart as getMarkdownVisibleLineStartPosition,
} from "../syntax/markdownElements";
import {
  continueMarkdownListItem,
  indentMarkdownListItem,
  outdentMarkdownListItem,
  setMarkdownHeadingLevel,
  toggleMarkdownList,
  toggleMarkdownQuote,
} from "./markdownBlockCommands";
import { toggleMarkdownHtmlTag, toggleMarkdownInline, wrapMarkdownLink } from "./markdownInlineCommands";

export const markdownEditingKeymap: readonly KeyBinding[] = [
  { key: "Escape", run: collapseMarkdownRevealedSource },
  { key: "Backspace", run: deleteMarkdownMarkerBackward },
  { key: "Delete", run: deleteMarkdownMarkerForward },
  { key: "Enter", run: handleMarkdownEnter },
  { key: "ArrowLeft", run: moveMarkdownCaretLeftAcrossHiddenBlockMarker },
  { key: "Home", run: moveMarkdownCaretToVisibleLineStart },
  { key: "Mod-ArrowLeft", run: moveMarkdownCaretToVisibleLineStart },
  { key: "Tab", run: indentMarkdownListItem },
  { key: "Shift-Tab", run: outdentMarkdownListItem },
  { key: "Mod-0", run: setMarkdownHeadingLevel(0), preventDefault: true },
  { key: "Mod-1", run: setMarkdownHeadingLevel(1), preventDefault: true },
  { key: "Mod-2", run: setMarkdownHeadingLevel(2), preventDefault: true },
  { key: "Mod-3", run: setMarkdownHeadingLevel(3), preventDefault: true },
  { key: "Mod-4", run: setMarkdownHeadingLevel(4), preventDefault: true },
  { key: "Mod-5", run: setMarkdownHeadingLevel(5), preventDefault: true },
  { key: "Mod-6", run: setMarkdownHeadingLevel(6), preventDefault: true },
  { key: "Mod-Shift-7", run: toggleMarkdownList("ordered"), preventDefault: true },
  { key: "Mod-Shift-8", run: toggleMarkdownList("bullet"), preventDefault: true },
  { key: "Mod-Shift-9", run: toggleMarkdownList("task"), preventDefault: true },
  { key: "Mod-Shift-.", run: toggleMarkdownQuote, preventDefault: true },
  { key: "Mod-b", run: toggleMarkdownInline("**"), preventDefault: true },
  { key: "Mod-i", run: toggleMarkdownInline("*"), preventDefault: true },
  { key: "Mod-u", run: toggleMarkdownHtmlTag("u"), preventDefault: true },
  { key: "Mod-e", run: toggleMarkdownInline("`"), preventDefault: true },
  { key: "Mod-d", run: toggleMarkdownInline("~~"), preventDefault: true },
  { key: "Mod-Shift-x", run: toggleMarkdownInline("~~"), preventDefault: true },
  { key: "Mod-k", run: wrapMarkdownLink, preventDefault: true },
];

function collapseMarkdownRevealedSource(view: EditorView): boolean {
  const revealed = view.state.field(markdownRevealedSourceField, false);
  if (!revealed) return false;
  view.dispatch({
    effects: markdownRevealedSourceEffect.of(null),
    selection: EditorSelection.cursor(revealed.to),
  });
  return true;
}

function moveMarkdownCaretLeftAcrossHiddenBlockMarker(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  if (!selection.empty) return false;

  const line = state.doc.lineAt(selection.from);
  const composingLine = state.field(markdownComposingBlockLineField, false);
  if (composingLine?.from === line.from) return false;

  const visibleStart = getMarkdownVisibleLineStartPosition(state, line.from);
  if (visibleStart == null || selection.from !== visibleStart || line.from === 0) return false;

  view.dispatch({ selection: EditorSelection.cursor(line.from - 1) });
  return true;
}

function deleteMarkdownMarkerBackward(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  if (!selection.empty) return false;
  if (isSelectionInComposingBlockLine(state, selection.from)) return false;

  const deletion =
    getBlockMarkerAtVisibleStart(state, selection.from) ??
    getCollapsedMarkerDeletionUnit(state, selection.from, "backward");
  if (!deletion) return false;

  view.dispatch({
    changes: deletion,
    selection: EditorSelection.cursor(deletion.from),
  });
  return true;
}

function deleteMarkdownMarkerForward(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  if (!selection.empty) return false;
  if (isSelectionInComposingBlockLine(state, selection.from)) return false;

  const deletion = getCollapsedMarkerDeletionUnit(state, selection.from, "forward");
  if (!deletion) return false;

  view.dispatch({
    changes: deletion,
    selection: EditorSelection.cursor(deletion.from),
  });
  return true;
}

function handleMarkdownEnter(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly || state.selection.ranges.length !== 1) return false;
  if (expandSelectedInlineAtom(view)) return true;

  const selection = state.selection.main;
  if (!selection.empty) return false;

  const item = getMarkdownListItemAt(state, selection.from);
  if (!item || item.quoted) return continueMarkdownMarkup(view);
  return continueMarkdownListItem(view, item);
}

// Quoted markup retains the language package's own source command.
const continueMarkdownMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

function expandSelectedInlineAtom(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) return false;

  const entry = getExpandableInlineAtomAtSelection(view.state, selection.from, selection.to);
  if (!entry || entry.plan.presentation !== "inlineAtom") return false;

  if (entry.plan.atom.kind === "image") {
    view.dispatch({
      effects: markdownRevealedSourceEffect.of({
        from: entry.plan.sourceRange.from,
        to: entry.plan.sourceRange.to,
        presentation: "inline",
      }),
      selection: EditorSelection.cursor(entry.plan.sourceRange.from + 2),
    });
    return true;
  }

  if (entry.plan.atom.kind === "lineBreak") {
    // Explicit expansion: place the caret inside the revealed source tag.
    view.dispatch({
      selection: EditorSelection.cursor(entry.plan.sourceRange.from + 1),
    });
    return true;
  }

  return false;
}

function moveMarkdownCaretToVisibleLineStart(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;

  const selection = state.selection.main;
  if (!selection.empty) return false;

  const line = state.doc.lineAt(selection.from);
  const visibleStart = getMarkdownVisibleLineStartPosition(state, line.from);
  if (visibleStart == null || selection.from === visibleStart) return false;

  view.dispatch({ selection: EditorSelection.cursor(visibleStart) });
  return true;
}
