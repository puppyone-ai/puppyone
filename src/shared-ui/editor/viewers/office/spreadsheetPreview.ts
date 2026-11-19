export const MAX_SPREADSHEET_SHEETS = 12;
export const MAX_SPREADSHEET_ROWS = 5_000;
export const MAX_SPREADSHEET_COLUMNS = 36;
export const MAX_SPREADSHEET_MATERIALIZED_CELLS = 200_000;
export const MAX_SPREADSHEET_STRING_PAYLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_SPREADSHEET_STYLES = 2_048;

export type SpreadsheetArchiveKind = "none" | "ooxml" | "ods";

export type SpreadsheetCellKind =
  | "blank"
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "error";

export type SpreadsheetCellBorder = {
  color: string;
  style: "solid" | "dashed" | "dotted" | "double";
  width: number;
};

/** A bounded, renderer-safe subset of workbook cell formatting. */
export type SpreadsheetCellStyle = {
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  wrapText?: boolean;
  borderTop?: SpreadsheetCellBorder;
  borderRight?: SpreadsheetCellBorder;
  borderBottom?: SpreadsheetCellBorder;
  borderLeft?: SpreadsheetCellBorder;
};

export type SpreadsheetCellAddress = {
  rowIndex: number;
  columnIndex: number;
};

export type SpreadsheetCellPosition = {
  rowPosition: number;
  columnPosition: number;
};

export type SpreadsheetBudgetTruncationReason =
  | "materialized-cell-limit"
  | "string-payload-limit";

export type SpreadsheetBudgetUsage = {
  /** Row cell values plus merge payload records included in the normalized result. */
  materializedCells: number;
  /** Conservative UTF-16 byte charge for sheet names, displayed values, and formulas. */
  stringPayloadBytes: number;
  truncated: boolean;
  truncationReasons: SpreadsheetBudgetTruncationReason[];
};

export function getSpreadsheetArchiveKind(extension: string): SpreadsheetArchiveKind {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  if (normalized === "xlsx" || normalized === "xlsm" || normalized === "xlsb") return "ooxml";
  if (normalized === "ods" || normalized === "ots") return "ods";
  return "none";
}

export type SpreadsheetPreviewResult = {
  kind: "spreadsheet";
  sheets: SpreadsheetSheet[];
  styles: SpreadsheetCellStyle[];
  /** Workbook-level typography inherited by cells without an explicit font. */
  defaultFontFamily: string | null;
  /** Workbook default font size in CSS pixels (OOXML points converted at 96dpi). */
  defaultFontSize: number | null;
  totalVisibleSheets: number;
  hiddenSheetCount: number;
  truncatedSheetCount: number;
  budget: SpreadsheetBudgetUsage;
};

export type SpreadsheetSheet = {
  name: string;
  rows: SpreadsheetSourceRow[];
  columns: SpreadsheetColumn[];
  merges: SpreadsheetMerge[];
  totalRows: number;
  totalColumns: number;
  totalVisibleRows: number;
  totalVisibleColumns: number;
  hiddenRowCount: number;
  hiddenColumnCount: number;
  showGridLines: boolean;
  /** The worksheet zoom saved by the author; one scale for the entire canvas. */
  displayScale: number;
  frozenRows: number;
  frozenColumns: number;
  initialSelection: SpreadsheetCellAddress | null;
  truncatedRows: boolean;
  truncatedColumns: boolean;
  budget: SpreadsheetBudgetUsage;
};

export type SpreadsheetSourceRow = {
  rowIndex: number;
  values: string[];
  kinds: SpreadsheetCellKind[];
  formulas: Array<string | null>;
  styleIds: number[];
  height: number;
};

export type SpreadsheetColumn = {
  columnIndex: number;
  width: number;
};

export type SpreadsheetMerge = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  value: string;
  kind: SpreadsheetCellKind;
  formula: string | null;
  styleId: number;
};

export type SpreadsheetRenderRow = {
  rowIndex: number;
  rowPosition: number;
  height: number;
  cells: SpreadsheetRenderCell[];
};

export type SpreadsheetRenderCell = {
  columnIndex: number;
  columnPosition: number;
  value: string;
  kind: SpreadsheetCellKind;
  formula: string | null;
  styleId: number;
  colSpan: number;
  rowSpan: number;
};

type WindowMergeCell = {
  merge: SpreadsheetMerge;
  isAnchor: boolean;
  rowSpan: number;
  colSpan: number;
};

/**
 * Materialize only the requested visible row window. Merges that begin above
 * the window are re-anchored at its first row, so their value and column
 * geometry remain visible without mounting every row back to the true anchor.
 */
export function getSpreadsheetRenderRows(
  sheet: SpreadsheetSheet,
  startRow: number,
  endRow: number,
): SpreadsheetRenderRow[] {
  const clampedStart = Math.max(0, Math.min(startRow, sheet.rows.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endRow, sheet.rows.length));
  const mergeCells = createWindowMergeCells(sheet.merges, clampedStart, clampedEnd);

  return sheet.rows.slice(clampedStart, clampedEnd).map((row, offset) => {
    const rowPosition = clampedStart + offset;
    const cells: SpreadsheetRenderCell[] = [];

    for (let columnPosition = 0; columnPosition < sheet.columns.length; columnPosition += 1) {
      const mergeCell = mergeCells.get(cellPositionKey(rowPosition, columnPosition));
      if (mergeCell && !mergeCell.isAnchor) continue;

      const column = sheet.columns[columnPosition];
      cells.push({
        columnIndex: column.columnIndex,
        columnPosition,
        value: mergeCell?.merge.value ?? row.values[columnPosition] ?? "",
        kind: mergeCell?.merge.kind ?? row.kinds[columnPosition] ?? "blank",
        formula: mergeCell?.merge.formula ?? row.formulas[columnPosition] ?? null,
        styleId: mergeCell?.merge.styleId ?? row.styleIds[columnPosition] ?? 0,
        colSpan: mergeCell?.colSpan ?? 1,
        rowSpan: mergeCell?.rowSpan ?? 1,
      });
    }

    return {
      rowIndex: row.rowIndex,
      rowPosition,
      height: row.height,
      cells,
    };
  });
}

function createWindowMergeCells(
  merges: SpreadsheetMerge[],
  startRow: number,
  endRow: number,
): Map<string, WindowMergeCell> {
  const cells = new Map<string, WindowMergeCell>();
  if (startRow >= endRow) return cells;

  for (const merge of merges) {
    const intersectionStartRow = Math.max(startRow, merge.startRow);
    const intersectionEndRow = Math.min(endRow - 1, merge.endRow);
    if (intersectionStartRow > intersectionEndRow) continue;

    const anchorRow = intersectionStartRow;
    const rowSpan = intersectionEndRow - intersectionStartRow + 1;
    const colSpan = merge.endColumn - merge.startColumn + 1;

    for (let row = intersectionStartRow; row <= intersectionEndRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        const key = cellPositionKey(row, column);
        if (cells.has(key)) continue;
        cells.set(key, {
          merge,
          isAnchor: row === anchorRow && column === merge.startColumn,
          rowSpan,
          colSpan,
        });
      }
    }
  }

  return cells;
}

function cellPositionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function getSpreadsheetRowOffsets(rows: readonly SpreadsheetSourceRow[]): number[] {
  const offsets = new Array<number>(rows.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < rows.length; index += 1) {
    offsets[index + 1] = offsets[index] + rows[index].height;
  }
  return offsets;
}

export function getSpreadsheetVisibleRowWindow({
  rowOffsets,
  scrollTop,
  viewportHeight,
  frozenRows,
  overscanRows,
}: {
  rowOffsets: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  frozenRows: number;
  overscanRows: number;
}): { startRow: number; endRow: number; topSpacerHeight: number; bottomSpacerHeight: number } {
  const rowCount = Math.max(0, rowOffsets.length - 1);
  const frozenCount = Math.max(0, Math.min(frozenRows, rowCount));
  if (rowCount === 0) {
    return { startRow: 0, endRow: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }
  const firstVisible = findRowAtOffset(rowOffsets, Math.max(0, scrollTop));
  const lastVisible = findRowAtOffset(
    rowOffsets,
    Math.max(0, scrollTop) + Math.max(0, viewportHeight),
  );
  const startRow = Math.max(frozenCount, firstVisible - Math.max(0, overscanRows));
  const endRow = Math.min(rowCount, Math.max(startRow + 1, lastVisible + overscanRows + 1));
  return {
    startRow,
    endRow,
    topSpacerHeight: Math.max(0, rowOffsets[startRow] - rowOffsets[frozenCount]),
    bottomSpacerHeight: Math.max(0, rowOffsets[rowCount] - rowOffsets[endRow]),
  };
}

export function findSpreadsheetCellPosition(
  sheet: SpreadsheetSheet,
  address: SpreadsheetCellAddress | null,
): SpreadsheetCellPosition | null {
  if (sheet.rows.length === 0 || sheet.columns.length === 0) return null;
  const requestedRow = address
    ? sheet.rows.findIndex((row) => row.rowIndex === address.rowIndex)
    : -1;
  const requestedColumn = address
    ? sheet.columns.findIndex((column) => column.columnIndex === address.columnIndex)
    : -1;
  return normalizeSpreadsheetCellPosition(sheet.merges, {
    rowPosition: requestedRow >= 0 ? requestedRow : 0,
    columnPosition: requestedColumn >= 0 ? requestedColumn : 0,
  });
}

export function getSpreadsheetNavigationTarget({
  key,
  selection,
  rowCount,
  columnCount,
  pageRows,
  merges = [],
}: {
  key: string;
  selection: SpreadsheetCellPosition;
  rowCount: number;
  columnCount: number;
  pageRows: number;
  merges?: readonly SpreadsheetMerge[];
}): SpreadsheetCellPosition | null {
  if (rowCount <= 0 || columnCount <= 0) return null;
  let { rowPosition, columnPosition } = selection;
  const currentMerge = findSpreadsheetMerge(merges, selection);
  switch (key) {
    case "ArrowLeft":
      columnPosition = (currentMerge?.startColumn ?? columnPosition) - 1;
      break;
    case "ArrowRight":
    case "Tab":
      columnPosition = (currentMerge?.endColumn ?? columnPosition) + 1;
      break;
    case "ArrowUp":
      rowPosition = (currentMerge?.startRow ?? rowPosition) - 1;
      break;
    case "ArrowDown":
    case "Enter":
      rowPosition = (currentMerge?.endRow ?? rowPosition) + 1;
      break;
    case "PageUp":
      rowPosition -= Math.max(1, pageRows);
      break;
    case "PageDown":
      rowPosition += Math.max(1, pageRows);
      break;
    case "Home":
      columnPosition = 0;
      break;
    case "End":
      columnPosition = columnCount - 1;
      break;
    default:
      return null;
  }
  return normalizeSpreadsheetCellPosition(merges, {
    rowPosition: Math.max(0, Math.min(rowCount - 1, rowPosition)),
    columnPosition: Math.max(0, Math.min(columnCount - 1, columnPosition)),
  });
}

function normalizeSpreadsheetCellPosition(
  merges: readonly SpreadsheetMerge[],
  position: SpreadsheetCellPosition,
): SpreadsheetCellPosition {
  const merge = findSpreadsheetMerge(merges, position);
  return merge
    ? { rowPosition: merge.startRow, columnPosition: merge.startColumn }
    : position;
}

function findSpreadsheetMerge(
  merges: readonly SpreadsheetMerge[],
  position: SpreadsheetCellPosition,
): SpreadsheetMerge | null {
  return merges.find((merge) => (
    position.rowPosition >= merge.startRow
    && position.rowPosition <= merge.endRow
    && position.columnPosition >= merge.startColumn
    && position.columnPosition <= merge.endColumn
  )) ?? null;
}

function findRowAtOffset(rowOffsets: readonly number[], offset: number): number {
  const rowCount = Math.max(0, rowOffsets.length - 1);
  if (rowCount === 0) return 0;
  let low = 0;
  let high = rowCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rowOffsets[middle + 1] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(rowCount - 1, low);
}
