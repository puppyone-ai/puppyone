import { ensureShape } from "./csvDocument";

export const MAX_CSV_TABLE_DATA_ROWS = 10000;
export const MAX_CSV_TABLE_COLUMNS = 256;

export type CsvTableFocusTarget = Readonly<{
  rowIndex: number;
  columnIndex: number;
}>;

export type CsvTableStructureOperation =
  | { type: "insert-row-above"; rowIndex: number; columnIndex: number }
  | { type: "insert-row-below"; rowIndex: number; columnIndex: number }
  | { type: "duplicate-row"; rowIndex: number; columnIndex: number }
  | { type: "move-row-up"; rowIndex: number; columnIndex: number }
  | { type: "move-row-down"; rowIndex: number; columnIndex: number }
  | { type: "move-row-to"; rowIndex: number; columnIndex: number; targetRowIndex: number }
  | { type: "delete-row"; rowIndex: number; columnIndex: number }
  | { type: "insert-column-left"; rowIndex: number; columnIndex: number }
  | { type: "insert-column-right"; rowIndex: number; columnIndex: number }
  | { type: "move-column-left"; rowIndex: number; columnIndex: number }
  | { type: "move-column-right"; rowIndex: number; columnIndex: number }
  | { type: "move-column-to"; rowIndex: number; columnIndex: number; targetColumnIndex: number }
  | { type: "delete-column"; rowIndex: number; columnIndex: number }
  | {
      type: "expand-to-shape";
      rowIndex: number;
      columnIndex: number;
      targetDataRowCount: number;
      targetColumnCount: number;
    };

export type CsvTableOperationResult = Readonly<{
  rows: string[][];
  focus: CsvTableFocusTarget;
}>;

/** Pure structural edit model. The first row remains fixed when it is a header. */
export function applyCsvTableOperation(
  sourceRows: readonly (readonly string[])[],
  headerEnabled: boolean,
  operation: CsvTableStructureOperation,
): CsvTableOperationResult {
  const columnCount = Math.max(1, ...sourceRows.map((row) => row.length));
  const rows = ensureShape(
    sourceRows.map((row) => [...row]),
    Math.max(1, sourceRows.length),
    columnCount,
  );
  const firstMovableRow = headerEnabled ? 1 : 0;
  const requestedRowIsMovable = Number.isInteger(operation.rowIndex)
    && operation.rowIndex >= firstMovableRow
    && operation.rowIndex < rows.length;
  const rowIndex = clampInteger(operation.rowIndex, firstMovableRow, Math.max(firstMovableRow, rows.length - 1));
  const columnIndex = clampInteger(operation.columnIndex, 0, columnCount - 1);
  let focus: CsvTableFocusTarget = {
    rowIndex: Math.min(rowIndex, rows.length - 1),
    columnIndex,
  };

  switch (operation.type) {
    case "insert-row-above": {
      const insertIndex = clampInteger(rowIndex, firstMovableRow, rows.length);
      rows.splice(insertIndex, 0, createEmptyRow(columnCount));
      focus = { rowIndex: insertIndex, columnIndex: 0 };
      break;
    }
    case "insert-row-below": {
      const insertIndex = clampInteger(rowIndex + 1, firstMovableRow, rows.length);
      rows.splice(insertIndex, 0, createEmptyRow(columnCount));
      focus = { rowIndex: insertIndex, columnIndex: 0 };
      break;
    }
    case "duplicate-row": {
      if (requestedRowIsMovable && rowIndex < rows.length) {
        const insertIndex = rowIndex + 1;
        rows.splice(insertIndex, 0, [...rows[rowIndex]]);
        focus = { rowIndex: insertIndex, columnIndex: 0 };
      }
      break;
    }
    case "move-row-up": {
      if (requestedRowIsMovable && rowIndex > firstMovableRow && rowIndex < rows.length) {
        swapArrayItems(rows, rowIndex, rowIndex - 1);
        focus = { rowIndex: rowIndex - 1, columnIndex };
      }
      break;
    }
    case "move-row-down": {
      if (requestedRowIsMovable && rowIndex >= firstMovableRow && rowIndex < rows.length - 1) {
        swapArrayItems(rows, rowIndex, rowIndex + 1);
        focus = { rowIndex: rowIndex + 1, columnIndex };
      }
      break;
    }
    case "move-row-to": {
      const targetRowIndex = clampInteger(
        operation.targetRowIndex,
        firstMovableRow,
        Math.max(firstMovableRow, rows.length - 1),
      );
      if (requestedRowIsMovable && rowIndex < rows.length && rowIndex !== targetRowIndex) {
        moveArrayItem(rows, rowIndex, targetRowIndex);
        focus = { rowIndex: targetRowIndex, columnIndex };
      }
      break;
    }
    case "delete-row": {
      if (requestedRowIsMovable && rowIndex < rows.length) {
        if (headerEnabled || rows.length > 1) {
          rows.splice(rowIndex, 1);
        } else {
          rows[0] = createEmptyRow(columnCount);
        }
        const nextRowIndex = rows.length > firstMovableRow
          ? Math.max(firstMovableRow, Math.min(rowIndex, rows.length - 1))
          : Math.max(0, rows.length - 1);
        focus = {
          rowIndex: nextRowIndex,
          columnIndex,
        };
      }
      break;
    }
    case "insert-column-left": {
      for (const row of rows) row.splice(columnIndex, 0, "");
      focus = { rowIndex: Math.min(rowIndex, rows.length - 1), columnIndex };
      break;
    }
    case "insert-column-right": {
      const insertIndex = columnIndex + 1;
      for (const row of rows) row.splice(insertIndex, 0, "");
      focus = { rowIndex: Math.min(rowIndex, rows.length - 1), columnIndex: insertIndex };
      break;
    }
    case "move-column-left": {
      if (columnIndex > 0) {
        for (const row of rows) swapArrayItems(row, columnIndex, columnIndex - 1);
        focus = { rowIndex: Math.min(rowIndex, rows.length - 1), columnIndex: columnIndex - 1 };
      }
      break;
    }
    case "move-column-right": {
      if (columnIndex < columnCount - 1) {
        for (const row of rows) swapArrayItems(row, columnIndex, columnIndex + 1);
        focus = { rowIndex: Math.min(rowIndex, rows.length - 1), columnIndex: columnIndex + 1 };
      }
      break;
    }
    case "move-column-to": {
      const targetColumnIndex = clampInteger(operation.targetColumnIndex, 0, columnCount - 1);
      if (columnIndex !== targetColumnIndex) {
        for (const row of rows) moveArrayItem(row, columnIndex, targetColumnIndex);
        focus = { rowIndex: Math.min(rowIndex, rows.length - 1), columnIndex: targetColumnIndex };
      }
      break;
    }
    case "delete-column": {
      if (columnCount > 1) {
        for (const row of rows) row.splice(columnIndex, 1);
        focus = {
          rowIndex: Math.min(rowIndex, rows.length - 1),
          columnIndex: Math.min(columnIndex, columnCount - 2),
        };
      }
      break;
    }
    case "expand-to-shape": {
      const headerRowCount = headerEnabled ? 1 : 0;
      const currentDataRowCount = Math.max(0, rows.length - headerRowCount);
      const targetDataRowCount = Math.max(
        currentDataRowCount,
        clampInteger(operation.targetDataRowCount, 0, MAX_CSV_TABLE_DATA_ROWS),
      );
      const targetColumnCount = Math.max(
        columnCount,
        clampInteger(operation.targetColumnCount, 1, MAX_CSV_TABLE_COLUMNS),
      );
      const targetRowCount = Math.max(1, targetDataRowCount + headerRowCount);
      const originalRowCount = rows.length;

      for (const row of rows) {
        while (row.length < targetColumnCount) row.push("");
      }
      while (rows.length < targetRowCount) rows.push(createEmptyRow(targetColumnCount));

      const rowsExpanded = rows.length > originalRowCount;
      const columnsExpanded = targetColumnCount > columnCount;
      const firstFocusableRow = Math.min(headerRowCount, rows.length - 1);
      focus = {
        rowIndex: rowsExpanded
          ? originalRowCount
          : clampInteger(rowIndex, firstFocusableRow, rows.length - 1),
        columnIndex: columnsExpanded ? columnCount : columnIndex,
      };
      break;
    }
  }

  return { rows, focus };
}

function createEmptyRow(columnCount: number): string[] {
  return Array.from({ length: columnCount }, () => "");
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function swapArrayItems<Value>(items: Value[], firstIndex: number, secondIndex: number) {
  [items[firstIndex], items[secondIndex]] = [items[secondIndex], items[firstIndex]];
}

function moveArrayItem<Value>(items: Value[], sourceIndex: number, targetIndex: number) {
  const [item] = items.splice(sourceIndex, 1);
  items.splice(targetIndex, 0, item);
}
