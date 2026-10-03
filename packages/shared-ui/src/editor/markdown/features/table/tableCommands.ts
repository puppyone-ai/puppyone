import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  applyMarkdownTableOperation,
  type MarkdownTableAlignment,
  type MarkdownTableRow,
  type MarkdownTableStructureOperation,
} from "./tableModel";
import { normalizeLineEndings } from "../../shared/widgets/widgetDom";
import { requestMarkdownTableFocus } from "./tableFocusState";
import { closeActiveMarkdownTableMenu } from "./tableMenuState";
import {
  requestMarkdownTableStructuralSelection,
  type MarkdownTableStructuralSelectionAxis,
} from "./tableStructuralSelectionState";
import {
  markdownInlineViewportContinuityEffect,
  type EmbeddedInlineViewportSequenceChange,
} from "../../platform/codemirror/embeddedInlineViewportSession";

export type MarkdownTableDispatchContext = {
  alignments: readonly MarkdownTableAlignment[];
  currentDraft?: MarkdownTableCellDraft | null;
  rows: readonly MarkdownTableRow[];
  tableFrom: number;
  tableTo: number;
  view: EditorView;
};

export type MarkdownTableCellDraft = {
  columnIndex: number;
  rowIndex: number;
  text: string;
};

export function dispatchMarkdownTableStructureOperation(
  context: MarkdownTableDispatchContext,
  operation: MarkdownTableStructureOperation,
  options: Readonly<{
    focus?: "operation-target" | "preserve";
    structuralSelection?: MarkdownTableStructuralSelectionAxis;
  }> = {},
) {
  closeActiveMarkdownTableMenu();
  const result = applyMarkdownTableOperation({
    alignments: context.alignments,
    rows: getMarkdownTableRowsWithDraft(context.rows, context.currentDraft),
  }, operation);

  const continuity = operation.type === "delete-table"
    ? null
    : markdownInlineViewportContinuityEffect.of({
      featureId: "markdown-table",
      oldRange: { from: context.tableFrom, to: context.tableTo },
      newRange: {
        from: context.tableFrom,
        to: context.tableFrom + result.replacement.length,
      },
      sequenceChange: getMarkdownTableInlineSequenceChange(
        operation,
        Math.max(1, context.alignments.length),
      ),
    });
  const restoreOperationFocus = options.focus !== "preserve";
  const structuralSelection = options.structuralSelection && result.focus
    ? requestMarkdownTableStructuralSelection(
      context.tableFrom,
      options.structuralSelection,
      options.structuralSelection === "row" ? result.focus.rowIndex : result.focus.columnIndex,
    )
    : null;
  const effects = [
    continuity,
    restoreOperationFocus && result.focus
      ? requestMarkdownTableFocus(context.tableFrom, result.focus)
      : null,
    structuralSelection,
  ].filter((effect) => effect !== null);

  context.view.dispatch({
    changes: {
      from: context.tableFrom,
      to: context.tableTo,
      insert: result.replacement,
    },
    selection: restoreOperationFocus ? EditorSelection.cursor(context.tableFrom) : undefined,
    effects: effects.length > 0 ? effects : undefined,
  });
  if (restoreOperationFocus && !result.focus) context.view.focus();
}

export function getMarkdownTableInlineSequenceChange(
  operation: MarkdownTableStructureOperation,
  columnCount: number,
): EmbeddedInlineViewportSequenceChange {
  const lastColumnIndex = Math.max(0, columnCount - 1);
  const columnIndex = clampInteger(operation.columnIndex, 0, lastColumnIndex);
  switch (operation.type) {
    case "insert-column-left":
      return { kind: "insert", index: columnIndex, count: 1 };
    case "insert-column-right":
      return { kind: "insert", index: columnIndex + 1, count: 1 };
    case "delete-column":
      return columnCount > 1
        ? { kind: "delete", index: columnIndex, count: 1 }
        : { kind: "preserve" };
    case "move-column-left":
      return columnIndex > 0
        ? { kind: "move", fromIndex: columnIndex, toIndex: columnIndex - 1 }
        : { kind: "preserve" };
    case "move-column-right":
      return columnIndex < lastColumnIndex
        ? { kind: "move", fromIndex: columnIndex, toIndex: columnIndex + 1 }
        : { kind: "preserve" };
    case "move-column-to":
      return {
        kind: "move",
        fromIndex: columnIndex,
        toIndex: clampInteger(operation.targetColumnIndex, 0, lastColumnIndex),
      };
    default:
      return { kind: "preserve" };
  }
}

function getMarkdownTableRowsWithDraft(
  rows: readonly MarkdownTableRow[],
  draft: MarkdownTableCellDraft | null | undefined,
): string[][] {
  const nextRows = rows.map((row) => row.cells.map((cell) => cell.text));
  if (draft && nextRows[draft.rowIndex]?.[draft.columnIndex] != null) {
    nextRows[draft.rowIndex][draft.columnIndex] = draft.text;
  }
  return nextRows;
}

export function getActiveMarkdownTableCellDraft(wrapper: HTMLElement): MarkdownTableCellDraft | null {
  const activeElement = wrapper.ownerDocument.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  const cell = activeElement.closest<HTMLElement>(".cm-md-table-cell-content[data-md-table-editing='true']");
  if (!cell || !wrapper.contains(cell)) return null;
  return getMarkdownTableCellDraft(cell);
}

function getMarkdownTableCellDraft(cell: HTMLElement): MarkdownTableCellDraft | null {
  const rowIndex = Number.parseInt(cell.dataset.mdTableRow ?? "", 10);
  const columnIndex = Number.parseInt(cell.dataset.mdTableColumn ?? "", 10);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return null;
  return {
    columnIndex,
    rowIndex,
    text: normalizeMarkdownTableCellInput(cell.textContent ?? ""),
  };
}

export function normalizeMarkdownTableCellInput(value: string): string {
  return normalizeLineEndings(value).replace(/\n+/g, " ").trim();
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
