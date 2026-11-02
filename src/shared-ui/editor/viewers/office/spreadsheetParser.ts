import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import { validateOfficePackageDecompression } from "../../security/officePackageValidationTask";
import { preflightOdsPackage, preflightOoxmlPackage } from "../../security/zipCentralDirectoryPreflight";
import {
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_MATERIALIZED_CELLS,
  MAX_SPREADSHEET_ROWS,
  MAX_SPREADSHEET_SHEETS,
  MAX_SPREADSHEET_STYLES,
  MAX_SPREADSHEET_STRING_PAYLOAD_BYTES,
  type SpreadsheetColumn,
  type SpreadsheetArchiveKind,
  type SpreadsheetBudgetTruncationReason,
  type SpreadsheetBudgetUsage,
  type SpreadsheetCellKind,
  type SpreadsheetCellStyle,
  type SpreadsheetMerge,
  type SpreadsheetPreviewResult,
  type SpreadsheetSheet,
  type SpreadsheetSourceRow,
} from "./spreadsheetPreview";
import {
  createSpreadsheetOoxmlPresentationReader,
  type SpreadsheetOoxmlPresentationReader,
  type SpreadsheetOoxmlSheetPresentation,
} from "./spreadsheetOoxmlPresentation";

const MAX_EXCEL_ROWS = 1_048_576;
const MAX_EXCEL_COLUMNS = 16_384;
const UTF16_BYTES_PER_CODE_UNIT = 2;
const SPREADSHEET_PACKAGE_DECOMPRESSION_BUDGET = Object.freeze({
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
});

type XlsxModule = typeof import("xlsx");
type SheetMetadata = { name?: string; Hidden?: number; id?: string };
type RowMetadata = { hidden?: boolean; hpt?: number; hpx?: number };
type ColumnMetadata = { wpx?: number; wch?: number; hidden?: boolean };
type CellRange = { s: { r: number; c: number }; e: { r: number; c: number } };
type BudgetSnapshot = { materializedCells: number; stringPayloadBytes: number };
type NormalizedRows = {
  rows: SpreadsheetSourceRow[];
  rowIndices: number[];
  truncatedByBudget: boolean;
};
type NormalizedMerges = {
  merges: SpreadsheetMerge[];
  truncatedByBudget: boolean;
};
type NormalizedSheet = {
  sheet: Omit<SpreadsheetSheet, "budget">;
  truncatedByBudget: boolean;
};

class SpreadsheetNormalizationBudget {
  private materializedCells = 0;
  private stringPayloadBytes = 0;
  private readonly truncationReasons: SpreadsheetBudgetTruncationReason[] = [];

  get truncationReasonCount(): number {
    return this.truncationReasons.length;
  }

  snapshot(): BudgetSnapshot {
    return {
      materializedCells: this.materializedCells,
      stringPayloadBytes: this.stringPayloadBytes,
    };
  }

  canConsume(additionalCells: number, additionalStringBytes: number): boolean {
    let allowed = true;
    if (this.materializedCells + additionalCells > MAX_SPREADSHEET_MATERIALIZED_CELLS) {
      this.recordTruncationReason("materialized-cell-limit");
      allowed = false;
    }
    if (this.stringPayloadBytes + additionalStringBytes > MAX_SPREADSHEET_STRING_PAYLOAD_BYTES) {
      this.recordTruncationReason("string-payload-limit");
      allowed = false;
    }
    return allowed;
  }

  tryConsume(additionalCells: number, additionalStringBytes: number): boolean {
    if (!this.canConsume(additionalCells, additionalStringBytes)) return false;
    this.consumeReserved(additionalCells, additionalStringBytes);
    return true;
  }

  consumeReserved(additionalCells: number, additionalStringBytes: number): void {
    this.materializedCells += additionalCells;
    this.stringPayloadBytes += additionalStringBytes;
  }

  createUsage({
    start = { materializedCells: 0, stringPayloadBytes: 0 },
    reasonStart = 0,
    truncated,
  }: {
    start?: BudgetSnapshot;
    reasonStart?: number;
    truncated: boolean;
  }): SpreadsheetBudgetUsage {
    const truncationReasons = this.truncationReasons.slice(reasonStart);
    return {
      materializedCells: this.materializedCells - start.materializedCells,
      stringPayloadBytes: this.stringPayloadBytes - start.stringPayloadBytes,
      truncated: truncated || truncationReasons.length > 0,
      truncationReasons,
    };
  }

  private recordTruncationReason(reason: SpreadsheetBudgetTruncationReason): void {
    if (!this.truncationReasons.includes(reason)) this.truncationReasons.push(reason);
  }
}

class SpreadsheetStyleRegistry {
  private readonly keys = new Map<string, number>([["{}", 0]]);
  readonly styles: SpreadsheetCellStyle[] = [{}];

  intern(style: SpreadsheetCellStyle | undefined): number {
    if (!style || Object.keys(style).length === 0) return 0;
    const key = JSON.stringify(style);
    const existing = this.keys.get(key);
    if (existing !== undefined) return existing;
    if (this.styles.length >= MAX_SPREADSHEET_STYLES) return 0;
    const index = this.styles.length;
    this.styles.push(style);
    this.keys.set(key, index);
    return index;
  }
}

/** Parse and normalize a workbook inside the spreadsheet worker. */
export async function parseSpreadsheetPreview(
  arrayBuffer: ArrayBuffer,
  { archiveKind }: { archiveKind: SpreadsheetArchiveKind },
): Promise<SpreadsheetPreviewResult> {
  await validateSpreadsheetArchive(arrayBuffer, archiveKind);
  const XLSX = await import("xlsx");
  const metadataWorkbook = XLSX.read(arrayBuffer, {
    type: "array",
    sheets: [],
    bookDeps: false,
    bookFiles: false,
    bookProps: false,
    bookVBA: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellText: false,
    dense: false,
    password: "",
    PRN: false,
    WTF: true,
  });

  const hiddenSheetNames = getHiddenSheetNames(metadataWorkbook);
  const visibleSheetNames = metadataWorkbook.SheetNames.filter((name) => !hiddenSheetNames.has(name));
  const selectedSheetNames = visibleSheetNames.slice(0, MAX_SPREADSHEET_SHEETS);
  const budget = new SpreadsheetNormalizationBudget();
  const styleRegistry = new SpreadsheetStyleRegistry();

  if (selectedSheetNames.length === 0) {
    return {
      kind: "spreadsheet",
      sheets: [],
      styles: styleRegistry.styles,
      defaultFontFamily: null,
      defaultFontSize: null,
      totalVisibleSheets: visibleSheetNames.length,
      hiddenSheetCount: hiddenSheetNames.size,
      truncatedSheetCount: 0,
      budget: budget.createUsage({ truncated: false }),
    };
  }

  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    sheets: selectedSheetNames,
    sheetRows: MAX_SPREADSHEET_ROWS,
    bookDeps: false,
    bookFiles: false,
    bookProps: false,
    bookVBA: false,
    cellDates: true,
    cellFormula: true,
    cellHTML: false,
    cellNF: true,
    cellStyles: true,
    cellText: true,
    dense: false,
    password: "",
    PRN: false,
    WTF: true,
    xlfn: true,
  });

  const sheets: SpreadsheetSheet[] = [];
  const presentationReader = archiveKind === "ooxml"
    ? await createSpreadsheetOoxmlPresentationReader(
      arrayBuffer,
      ((workbook.Workbook?.Sheets ?? []) as SheetMetadata[])
        .filter((sheet): sheet is SheetMetadata & { id: string; name: string } => (
          typeof sheet.id === "string" && typeof sheet.name === "string"
        ))
        .map((sheet) => ({ id: sheet.id, name: sheet.name })),
    )
    : null;
  for (const sheetName of selectedSheetNames) {
    const sheetBudgetStart = budget.snapshot();
    const sheetReasonStart = budget.truncationReasonCount;
    if (!budget.tryConsume(0, utf16PayloadBytes(sheetName))) break;

    const normalized = await normalizeSpreadsheetSheet(
      XLSX,
      sheetName,
      workbook.Sheets[sheetName],
      budget,
      styleRegistry,
      presentationReader,
    );
    sheets.push({
      ...normalized.sheet,
      budget: budget.createUsage({
        start: sheetBudgetStart,
        reasonStart: sheetReasonStart,
        truncated: normalized.truncatedByBudget,
      }),
    });
    if (normalized.truncatedByBudget) break;
  }

  return {
    kind: "spreadsheet",
    sheets,
    styles: styleRegistry.styles,
    defaultFontFamily: presentationReader?.defaultFontFamily ?? null,
    defaultFontSize: presentationReader?.defaultFontSize ?? null,
    totalVisibleSheets: visibleSheetNames.length,
    hiddenSheetCount: hiddenSheetNames.size,
    truncatedSheetCount: Math.max(0, visibleSheetNames.length - sheets.length),
    budget: budget.createUsage({ truncated: budget.truncationReasonCount > 0 }),
  };
}

async function validateSpreadsheetArchive(
  arrayBuffer: ArrayBuffer,
  archiveKind: SpreadsheetArchiveKind,
): Promise<void> {
  if (archiveKind === "none") return;

  if (archiveKind === "ooxml") {
    preflightOoxmlPackage(arrayBuffer, SPREADSHEET_PACKAGE_DECOMPRESSION_BUDGET);
    await validateOfficePackageDecompression(arrayBuffer, {
      profile: "ooxml",
      budget: SPREADSHEET_PACKAGE_DECOMPRESSION_BUDGET,
    });
    return;
  }

  preflightOdsPackage(arrayBuffer, SPREADSHEET_PACKAGE_DECOMPRESSION_BUDGET);
  await validateOfficePackageDecompression(arrayBuffer, {
    profile: "zip",
    budget: SPREADSHEET_PACKAGE_DECOMPRESSION_BUDGET,
  });
}

async function normalizeSpreadsheetSheet(
  XLSX: XlsxModule,
  sheetName: string,
  worksheet: WorkSheet | undefined,
  budget: SpreadsheetNormalizationBudget,
  styleRegistry: SpreadsheetStyleRegistry,
  presentationReader: SpreadsheetOoxmlPresentationReader | null,
): Promise<NormalizedSheet> {
  const mergeRanges = (worksheet?.["!merges"] ?? []) as CellRange[];
  const parsedRange = expandWorksheetRange(
    decodeWorksheetRange(XLSX, worksheet?.["!ref"]),
    mergeRanges,
  );
  const fullRange = expandWorksheetRange(
    decodeWorksheetRange(
      XLSX,
      (worksheet as (WorkSheet & { "!fullref"?: string }) | undefined)?.["!fullref"] ?? worksheet?.["!ref"],
    ),
    mergeRanges,
  );

  if (!fullRange) {
    return {
      sheet: {
        name: sheetName,
        rows: [],
        columns: [],
        merges: [],
        totalRows: 0,
        totalColumns: 0,
        totalVisibleRows: 0,
        totalVisibleColumns: 0,
        hiddenRowCount: 0,
        hiddenColumnCount: 0,
        showGridLines: true,
        displayScale: 1,
        frozenRows: 0,
        frozenColumns: 0,
        initialSelection: null,
        truncatedRows: false,
        truncatedColumns: false,
      },
      truncatedByBudget: false,
    };
  }

  const rowMetadata = (worksheet?.["!rows"] ?? []) as RowMetadata[];
  const columnMetadata = (worksheet?.["!cols"] ?? []) as ColumnMetadata[];
  const totalRows = fullRange.e.r - fullRange.s.r + 1;
  const totalColumns = fullRange.e.c - fullRange.s.c + 1;
  const hiddenRowCount = countHiddenMetadata(rowMetadata, fullRange.s.r, fullRange.e.r);
  const hiddenColumnCount = countHiddenMetadata(columnMetadata, fullRange.s.c, fullRange.e.c);
  const totalVisibleRows = Math.max(0, totalRows - hiddenRowCount);
  const totalVisibleColumns = Math.max(0, totalColumns - hiddenColumnCount);
  const rowIndices = createVisibleRowIndices(parsedRange, rowMetadata);
  const allVisibleColumnIndices = createVisibleColumnIndices(fullRange, columnMetadata);
  const visibleColumnIndices = allVisibleColumnIndices.slice(0, MAX_SPREADSHEET_COLUMNS);
  const columns = createSpreadsheetColumns(visibleColumnIndices, columnMetadata);
  const presentation = await presentationReader?.readSheet(
    sheetName,
    rowIndices,
    visibleColumnIndices,
  ) ?? null;
  const normalizedRows = createSpreadsheetRows(
    worksheet,
    rowIndices,
    visibleColumnIndices,
    rowMetadata,
    budget,
    styleRegistry,
    presentation,
    presentationReader?.styles ?? [],
  );
  const normalizedMerges = normalizedRows.truncatedByBudget
    ? { merges: [], truncatedByBudget: false }
    : createSpreadsheetMerges(
      worksheet,
      mergeRanges,
      normalizedRows.rowIndices,
      visibleColumnIndices,
      budget,
      styleRegistry,
      presentation,
      presentationReader?.styles ?? [],
    );

  return {
    sheet: {
      name: sheetName,
      rows: normalizedRows.rows,
      columns,
      merges: normalizedMerges.merges,
      totalRows,
      totalColumns,
      totalVisibleRows,
      totalVisibleColumns,
      hiddenRowCount,
      hiddenColumnCount,
      showGridLines: presentation?.showGridLines ?? true,
      displayScale: presentation?.displayScale ?? 1,
      frozenRows: countIndicesBefore(rowIndices, presentation?.frozenRows ?? 0),
      frozenColumns: countIndicesBefore(visibleColumnIndices, presentation?.frozenColumns ?? 0),
      initialSelection: decodeSpreadsheetCellReference(presentation?.activeCell),
      truncatedRows: totalVisibleRows > normalizedRows.rows.length,
      truncatedColumns: totalVisibleColumns > columns.length,
    },
    truncatedByBudget: normalizedRows.truncatedByBudget || normalizedMerges.truncatedByBudget,
  };
}

function getHiddenSheetNames(workbook: WorkBook): Set<string> {
  const metadata = (workbook.Workbook?.Sheets ?? []) as SheetMetadata[];
  return new Set(
    metadata
      .filter((sheet) => Boolean(sheet.Hidden))
      .map((sheet) => sheet.name)
      .filter((name): name is string => Boolean(name)),
  );
}

function decodeWorksheetRange(XLSX: XlsxModule, reference: string | undefined): CellRange | null {
  if (!reference) return null;
  const range = XLSX.utils.decode_range(reference);
  if (
    range.s.r < 0
    || range.s.c < 0
    || range.e.r < range.s.r
    || range.e.c < range.s.c
    || range.e.r >= MAX_EXCEL_ROWS
    || range.e.c >= MAX_EXCEL_COLUMNS
  ) {
    throw new Error(`Spreadsheet range is outside Excel limits: ${reference}`);
  }
  return range;
}

function expandWorksheetRange(range: CellRange | null, merges: readonly CellRange[]): CellRange | null {
  if (!range && merges.length === 0) return null;
  const expanded: CellRange = range
    ? { s: { ...range.s }, e: { ...range.e } }
    : { s: { ...merges[0].s }, e: { ...merges[0].e } };
  for (const merge of merges) {
    expanded.s.r = Math.min(expanded.s.r, merge.s.r);
    expanded.s.c = Math.min(expanded.s.c, merge.s.c);
    expanded.e.r = Math.max(expanded.e.r, merge.e.r);
    expanded.e.c = Math.max(expanded.e.c, merge.e.c);
  }
  return expanded;
}

function createVisibleRowIndices(range: CellRange | null, metadata: RowMetadata[]): number[] {
  if (!range) return [];
  const start = range.s.r;
  const end = Math.min(range.e.r, start + MAX_SPREADSHEET_ROWS - 1);
  const rows: number[] = [];
  for (let row = start; row <= end; row += 1) {
    if (!metadata[row]?.hidden) rows.push(row);
  }
  return rows;
}

function createVisibleColumnIndices(range: CellRange, metadata: ColumnMetadata[]): number[] {
  const columns: number[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    if (!metadata[column]?.hidden) columns.push(column);
  }
  return columns;
}

function countHiddenMetadata(
  metadata: Array<{ hidden?: boolean }>,
  start: number,
  end: number,
): number {
  let count = 0;
  const cappedEnd = Math.min(end, metadata.length - 1);
  for (let index = Math.max(0, start); index <= cappedEnd; index += 1) {
    if (metadata[index]?.hidden) count += 1;
  }
  return count;
}

function createSpreadsheetColumns(
  columnIndices: number[],
  metadata: ColumnMetadata[],
): SpreadsheetColumn[] {
  return columnIndices.map((columnIndex) => ({
    columnIndex,
    width: normalizeSpreadsheetColumnWidth(metadata[columnIndex]),
  }));
}

function createSpreadsheetRows(
  worksheet: WorkSheet | undefined,
  rowIndices: number[],
  columnIndices: number[],
  rowMetadata: RowMetadata[],
  budget: SpreadsheetNormalizationBudget,
  styleRegistry: SpreadsheetStyleRegistry,
  presentation: SpreadsheetOoxmlSheetPresentation | null,
  sourceStyles: readonly SpreadsheetCellStyle[],
): NormalizedRows {
  const rows: SpreadsheetSourceRow[] = [];
  const materializedRowIndices: number[] = [];

  for (const rowIndex of rowIndices) {
    const values: string[] = [];
    const kinds: SpreadsheetCellKind[] = [];
    const formulas: Array<string | null> = [];
    const styleIds: number[] = [];
    let reservedCells = 0;
    let reservedStringBytes = 0;

    for (const columnIndex of columnIndices) {
      const cell = worksheet?.[encodeSpreadsheetCell(rowIndex, columnIndex)] as CellObject | undefined;
      const value = getCellDisplayValue(cell);
      const stringBytes = getCellStringPayloadBytes(cell, value);
      if (!budget.canConsume(reservedCells + 1, reservedStringBytes + stringBytes)) {
        return {
          rows,
          rowIndices: materializedRowIndices,
          truncatedByBudget: true,
        };
      }
      reservedCells += 1;
      reservedStringBytes += stringBytes;
      values.push(value);
      kinds.push(getSpreadsheetCellKind(cell));
      formulas.push(getSpreadsheetCellFormula(cell));
      styleIds.push(getSpreadsheetCellStyleId(
        cell,
        encodeSpreadsheetCell(rowIndex, columnIndex),
        styleRegistry,
        presentation,
        sourceStyles,
      ));
    }

    budget.consumeReserved(reservedCells, reservedStringBytes);
    rows.push({
      rowIndex,
      values,
      kinds,
      formulas,
      styleIds,
      height: normalizeSpreadsheetRowHeight(rowMetadata[rowIndex]),
    });
    materializedRowIndices.push(rowIndex);
  }

  return {
    rows,
    rowIndices: materializedRowIndices,
    truncatedByBudget: false,
  };
}

function createSpreadsheetMerges(
  worksheet: WorkSheet | undefined,
  merges: CellRange[],
  rowIndices: number[],
  columnIndices: number[],
  budget: SpreadsheetNormalizationBudget,
  styleRegistry: SpreadsheetStyleRegistry,
  presentation: SpreadsheetOoxmlSheetPresentation | null,
  sourceStyles: readonly SpreadsheetCellStyle[],
): NormalizedMerges {
  const rowPositionByIndex = new Map(rowIndices.map((rowIndex, position) => [rowIndex, position]));
  const columnPositionByIndex = new Map(columnIndices.map((columnIndex, position) => [columnIndex, position]));
  const normalized: SpreadsheetMerge[] = [];

  for (const merge of merges) {
    const mergeRowPositions = getPositionsInRange(rowIndices, rowPositionByIndex, merge.s.r, merge.e.r);
    const mergeColumnPositions = getPositionsInRange(columnIndices, columnPositionByIndex, merge.s.c, merge.e.c);
    if (mergeRowPositions.length === 0 || mergeColumnPositions.length === 0) continue;

    const startRow = mergeRowPositions[0];
    const endRow = mergeRowPositions[mergeRowPositions.length - 1];
    const startColumn = mergeColumnPositions[0];
    const endColumn = mergeColumnPositions[mergeColumnPositions.length - 1];
    const cell = worksheet?.[encodeSpreadsheetCell(merge.s.r, merge.s.c)] as CellObject | undefined;
    const value = getCellDisplayValue(cell);

    if (!budget.tryConsume(1, getCellStringPayloadBytes(cell, value))) {
      return { merges: normalized, truncatedByBudget: true };
    }

    normalized.push({
      startRow,
      endRow,
      startColumn,
      endColumn,
      value,
      kind: getSpreadsheetCellKind(cell),
      formula: getSpreadsheetCellFormula(cell),
      styleId: getSpreadsheetCellStyleId(
        cell,
        encodeSpreadsheetCell(merge.s.r, merge.s.c),
        styleRegistry,
        presentation,
        sourceStyles,
      ),
    });
  }

  return { merges: normalized, truncatedByBudget: false };
}

function getPositionsInRange(
  indices: number[],
  positionByIndex: Map<number, number>,
  start: number,
  end: number,
): number[] {
  const positions: number[] = [];
  for (const index of indices) {
    if (index < start) continue;
    if (index > end) break;
    const position = positionByIndex.get(index);
    if (position !== undefined) positions.push(position);
  }
  return positions;
}

export function getCellDisplayValue(cell: CellObject | undefined): string {
  if (!cell) return "";
  if (cell.f && (cell.t === "z" || cell.v === undefined || cell.v === null)) {
    return `=${cell.f}`;
  }
  if (typeof cell.w === "string") return cell.w;
  if (cell.v instanceof Date) return cell.v.toLocaleDateString();
  if (cell.v === null || cell.v === undefined) return cell.f ? `=${cell.f}` : "";
  return String(cell.v);
}

export function getSpreadsheetCellKind(cell: CellObject | undefined): SpreadsheetCellKind {
  if (!cell || (cell.t === "z" && !cell.f && (cell.v === undefined || cell.v === null))) {
    return "blank";
  }
  if (cell.f && (cell.t === "z" || cell.v === undefined || cell.v === null)) return "text";
  if (cell.v instanceof Date || cell.t === "d") return "date";
  if (cell.t === "n") return "number";
  if (cell.t === "b") return "boolean";
  if (cell.t === "e") return "error";
  return "text";
}

function getSpreadsheetCellFormula(cell: CellObject | undefined): string | null {
  return typeof cell?.f === "string" && cell.f ? cell.f : null;
}

function getSpreadsheetCellStyleId(
  cell: CellObject | undefined,
  reference: string,
  registry: SpreadsheetStyleRegistry,
  presentation: SpreadsheetOoxmlSheetPresentation | null,
  sourceStyles: readonly SpreadsheetCellStyle[],
): number {
  const sourceStyleIndex = presentation?.styleIndexByCell.get(reference);
  if (sourceStyleIndex !== undefined) return registry.intern(sourceStyles[sourceStyleIndex]);
  return registry.intern(normalizeFallbackCellStyle(cell));
}

function normalizeFallbackCellStyle(cell: CellObject | undefined): SpreadsheetCellStyle | undefined {
  const style = cell?.s as {
    fgColor?: { rgb?: unknown };
    patternType?: unknown;
  } | undefined;
  if (style?.patternType !== "solid" || typeof style.fgColor?.rgb !== "string") return undefined;
  const raw = style.fgColor.rgb.replace(/^#/, "");
  const rgb = /^[0-9a-f]{8}$/i.test(raw) ? raw.slice(2) : raw;
  return /^[0-9a-f]{6}$/i.test(rgb) ? { backgroundColor: `#${rgb.toLowerCase()}` } : undefined;
}

function getCellStringPayloadBytes(cell: CellObject | undefined, displayValue: string): number {
  const formula = typeof cell?.f === "string" ? cell.f : "";
  return utf16PayloadBytes(displayValue) + utf16PayloadBytes(formula);
}

function utf16PayloadBytes(value: string): number {
  return value.length * UTF16_BYTES_PER_CODE_UNIT;
}

function normalizeSpreadsheetColumnWidth(column: ColumnMetadata | undefined): number {
  if (typeof column?.wpx === "number" && Number.isFinite(column.wpx)) {
    return clampSpreadsheetColumnWidth(column.wpx);
  }
  if (typeof column?.wch === "number" && Number.isFinite(column.wch)) {
    return clampSpreadsheetColumnWidth((column.wch * 7) + 12);
  }
  return 96;
}

function normalizeSpreadsheetRowHeight(row: RowMetadata | undefined): number {
  const pixels = typeof row?.hpx === "number" && Number.isFinite(row.hpx)
    ? row.hpx
    : typeof row?.hpt === "number" && Number.isFinite(row.hpt)
      ? row.hpt * (4 / 3)
      : 28;
  return Math.max(20, Math.min(160, Math.round(pixels)));
}

function countIndicesBefore(indices: number[], physicalIndex: number): number {
  let count = 0;
  for (const index of indices) {
    if (index >= physicalIndex) break;
    count += 1;
  }
  return count;
}

function decodeSpreadsheetCellReference(reference: string | null | undefined): {
  rowIndex: number;
  columnIndex: number;
} | null {
  if (!reference) return null;
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference);
  if (!match) return null;
  let columnIndex = 0;
  for (const character of match[1]) {
    columnIndex = (columnIndex * 26) + character.charCodeAt(0) - 64;
  }
  return {
    rowIndex: Number.parseInt(match[2], 10) - 1,
    columnIndex: columnIndex - 1,
  };
}

function clampSpreadsheetColumnWidth(width: number): number {
  return Math.max(42, Math.min(320, Math.round(width)));
}

function encodeSpreadsheetCell(rowIndex: number, columnIndex: number): string {
  return `${encodeSpreadsheetColumn(columnIndex)}${rowIndex + 1}`;
}

function encodeSpreadsheetColumn(columnIndex: number): string {
  let index = columnIndex + 1;
  let column = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    index = Math.floor((index - 1) / 26);
  }
  return column;
}
