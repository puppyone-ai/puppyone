import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { retireEditorTasks } from "../packages/shared-ui/src/editor/runtime/retireEditorTasks";
import * as XLSX from "xlsx";
import {
  getSpreadsheetCellKind,
  parseSpreadsheetPreview,
} from "../packages/shared-ui/src/editor/viewers/office/spreadsheetParser";
import {
  getSpreadsheetArchiveKind,
  getSpreadsheetNavigationTarget,
  getSpreadsheetRenderRows,
  getSpreadsheetRowOffsets,
  getSpreadsheetVisibleRowWindow,
  MAX_SPREADSHEET_MATERIALIZED_CELLS,
  MAX_SPREADSHEET_STRING_PAYLOAD_BYTES,
} from "../packages/shared-ui/src/editor/viewers/office/spreadsheetPreview";
import {
  DEFAULT_SPREADSHEET_WORKER_TIMEOUT_MS,
  parseSpreadsheetInWorker,
} from "../packages/shared-ui/src/editor/viewers/office/spreadsheetPreviewClient";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("spreadsheet preview parsing", () => {
  it("settles a waiting client when its owner retires the Worker", async () => {
    const worker = new FakeWorker(); stubWorker(worker);
    const parsing = parseSpreadsheetInWorker(new ArrayBuffer(8), { archiveKind: "none" });
    const rejected = expect(parsing).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    await retireEditorTasks();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("preserves native cell kinds for familiar worksheet alignment", () => {
    expect(getSpreadsheetCellKind(undefined)).toBe("blank");
    expect(getSpreadsheetCellKind({ t: "z" })).toBe("blank");
    expect(getSpreadsheetCellKind({ t: "s", v: "Label" })).toBe("text");
    expect(getSpreadsheetCellKind({ t: "n", v: 42 })).toBe("number");
    expect(getSpreadsheetCellKind({ t: "d", v: new Date("2026-08-09") })).toBe("date");
    expect(getSpreadsheetCellKind({ t: "b", v: true })).toBe("boolean");
    expect(getSpreadsheetCellKind({ t: "e", v: 7 })).toBe("error");
    expect(getSpreadsheetCellKind({ t: "z", f: "SUM(A1:A2)" })).toBe("text");
    expect(getSpreadsheetCellKind({ t: "n", f: "SUM(A1:A2)" })).toBe("text");
  });

  it.each(["xls", "xlsx", "xlsm", "xlsb", "ods"] as XLSX.BookType[])(
    "parses %s files through the normalized preview path",
    async (bookType) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Format", bookType]]), "Data");

      const result = await parseSpreadsheetPreview(writeWorkbook(workbook, bookType), {
        archiveKind: getSpreadsheetArchiveKind(bookType),
      });

      expect(result.sheets[0].rows[0].values).toEqual(["Format", bookType]);
    },
  );

  it("shows formulas without cached values instead of a synthetic zero", async () => {
    const fixture = readFileSync(path.join(
      process.cwd(),
      "tests/fixtures/editor-rendering/puppyone-preview-sample.xlsx",
    ));
    const result = await parseSpreadsheetPreview(toArrayBuffer(fixture), { archiveKind: "ooxml" });
    const overview = result.sheets.find((sheet) => sheet.name === "Overview");
    const totalRow = overview?.rows.find((row) => row.rowIndex === 5);

    expect(totalRow?.values[1]).toBe("=SUM(B3:B5)");
    expect(totalRow?.values[2]).toBe("=SUM(C3:C5)");
  });

  it("preserves bounded OOXML presentation styles, view state, and formulas", async () => {
    const source = readFileSync(path.join(
      process.cwd(),
      "tests/fixtures/editor-rendering/puppyone-preview-sample.xlsx",
    ));
    const styledWorkbook = await createStyledWorkbookFixture(source);
    const result = await parseSpreadsheetPreview(styledWorkbook, { archiveKind: "ooxml" });
    const sheet = result.sheets[0];
    const firstCellStyle = result.styles[sheet.rows[0].styleIds[0]];

    expect(firstCellStyle).toMatchObject({
      backgroundColor: "#0b2545",
      color: "#ffffff",
      fontFamily: "Arial",
      fontSize: 18.7,
      bold: true,
      horizontalAlign: "center",
      verticalAlign: "middle",
      wrapText: true,
      borderBottom: { color: "#d9e2ec", style: "solid", width: 1 },
    });
    expect(result.defaultFontFamily).toBe("Arial");
    expect(result.defaultFontSize).toBe(14.7);
    expect(sheet.showGridLines).toBe(false);
    expect(sheet.displayScale).toBe(0.85);
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.initialSelection).toEqual({ rowIndex: 2, columnIndex: 1 });
    expect(sheet.rows[5].formulas[1]).toBe("SUM(B3:B5)");
  });

  it("charges cached formula text against the UTF-16 payload budget", async () => {
    const formula = "SUM(1, 2, 3)";
    const worksheet = XLSX.utils.aoa_to_sheet([[6]]);
    worksheet.A1 = { t: "n", v: 6, f: formula };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Formula");

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });

    expect(result.sheets[0].rows[0].values[0]).toBe("6");
    expect(result.budget.stringPayloadBytes).toBeGreaterThanOrEqual(
      ("Formula".length + "6".length + formula.length) * 2,
    );
  });

  it("returns explicit truncation metadata for more than 12 visible sheets", async () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 1; index <= 13; index += 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[index]]), `Sheet ${index}`);
    }

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });

    expect(result.sheets).toHaveLength(12);
    expect(result.totalVisibleSheets).toBe(13);
    expect(result.truncatedSheetCount).toBe(1);
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Sheet ${index + 1}`),
    );
  });

  it("filters hidden and very-hidden sheets", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["visible"]]), "Visible");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["hidden"]]), "Hidden");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["very hidden"]]), "VeryHidden");
    workbook.Workbook = {
      Sheets: [
        { name: "Visible", Hidden: 0 },
        { name: "Hidden", Hidden: 1 },
        { name: "VeryHidden", Hidden: 2 },
      ],
    };

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });

    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Visible"]);
    expect(result.totalVisibleSheets).toBe(1);
    expect(result.hiddenSheetCount).toBe(2);
  });

  it("omits hidden rows and columns while preserving physical row and column indices", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["A1", "B1", "C1"],
      ["A2", "B2", "C2"],
      ["A3", "B3", "C3"],
    ]);
    worksheet["!rows"] = [{}, { hidden: true }, {}];
    worksheet["!cols"] = [{}, { hidden: true }, {}];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Visible dimensions");

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });
    const sheet = result.sheets[0];

    expect(sheet.rows.map((row) => row.rowIndex)).toEqual([0, 2]);
    expect(sheet.columns.map((column) => column.columnIndex)).toEqual([0, 2]);
    expect(sheet.rows.map((row) => row.values)).toEqual([
      ["A1", "C1"],
      ["A3", "C3"],
    ]);
    expect(sheet.hiddenRowCount).toBe(1);
    expect(sheet.hiddenColumnCount).toBe(1);
  });

  it("re-anchors a merged cell that crosses the virtual row window", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet(
      Array.from({ length: 10 }, (_, index) => [index === 0 ? "Merged" : "", `Row ${index + 1}`]),
    );
    worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 9, c: 0 } }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Merge");

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });
    const rows = getSpreadsheetRenderRows(result.sheets[0], 5, 8);

    expect(rows).toHaveLength(3);
    expect(rows[0].rowIndex).toBe(5);
    expect(rows[0].cells[0]).toMatchObject({
      columnIndex: 0,
      value: "Merged",
      kind: "text",
      rowSpan: 3,
      colSpan: 1,
    });
    expect(rows[1].cells.some((cell) => cell.columnIndex === 0)).toBe(false);
    expect(rows[2].cells.some((cell) => cell.columnIndex === 0)).toBe(false);
    expect(rows.map((row) => row.cells.find((cell) => cell.columnIndex === 1)?.value)).toEqual([
      "Row 6",
      "Row 7",
      "Row 8",
    ]);
  });

  it("routes OTS templates through the ODS package preflight and parser", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Template"]]), "Data");

    expect(getSpreadsheetArchiveKind(".ots")).toBe("ods");
    const result = await parseSpreadsheetPreview(writeWorkbook(workbook, "ods"), {
      archiveKind: getSpreadsheetArchiveKind("ots"),
    });

    expect(result.sheets[0].rows[0].values).toEqual(["Template"]);
  });

  it("rejects malformed OOXML and incomplete ODS archives before SheetJS parsing", async () => {
    const invalidOoxml = toArrayBuffer(new TextEncoder().encode("not a zip"));
    await expect(parseSpreadsheetPreview(invalidOoxml, { archiveKind: "ooxml" })).rejects.toMatchObject({
      name: "ZipPreflightError",
      code: "end-of-central-directory-not-found",
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["OOXML"]]), "Data");
    await expect(
      parseSpreadsheetPreview(writeWorkbook(workbook, "xlsx"), { archiveKind: "ods" }),
    ).rejects.toMatchObject({
      name: "ZipPreflightError",
      code: "missing-ods-entry",
    });
  });

  it("validates actual OOXML decompression output before SheetJS parsing", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["payload".repeat(100)]]),
      "Data",
    );
    const arrayBuffer = writeWorkbook(workbook);
    patchDeclaredUncompressedSize(arrayBuffer, "xl/worksheets/sheet1.xml", 1);

    await expect(
      parseSpreadsheetPreview(arrayBuffer, { archiveKind: "ooxml" }),
    ).rejects.toMatchObject({
      name: "OfficePackageValidationError",
      code: "actual-entry-size-mismatch",
      entryName: "xl/worksheets/sheet1.xml",
    });
  });

  it("caps materialized cells globally and stops normalizing later sheets", async () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 1; index <= 4; index += 1) {
      XLSX.utils.book_append_sheet(
        workbook,
        createSparseRangeSheet("A1:AJ2500"),
        `Budget ${index}`,
      );
    }

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });

    expect(result.budget).toMatchObject({
      materializedCells: 199_980,
      truncated: true,
      truncationReasons: ["materialized-cell-limit"],
    });
    expect(result.budget.materializedCells).toBeLessThanOrEqual(MAX_SPREADSHEET_MATERIALIZED_CELLS);
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["Budget 1", "Budget 2", "Budget 3"]);
    expect(result.sheets.map((sheet) => sheet.rows.length)).toEqual([2_500, 2_500, 555]);
    expect(result.sheets.map((sheet) => sheet.budget.truncated)).toEqual([false, false, true]);
    expect(result.sheets[2].truncatedRows).toBe(true);
    expect(result.truncatedSheetCount).toBe(1);
    expect(countNormalizedCellPayloads(result.sheets)).toBe(result.budget.materializedCells);
  }, 30_000);

  it("caps high-text workbooks by conservative UTF-16 payload before constructing later rows", async () => {
    const longValue = "x".repeat(32_000);
    const worksheet = XLSX.utils.aoa_to_sheet(
      Array.from({ length: 220 }, (_, index) => [`${longValue}${index}`]),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "High text");

    const result = await parseSpreadsheetPreview(writeWorkbook(workbook), { archiveKind: "ooxml" });
    const sheet = result.sheets[0];

    expect(result.budget.truncated).toBe(true);
    expect(result.budget.truncationReasons).toContain("string-payload-limit");
    expect(result.budget.stringPayloadBytes).toBeLessThanOrEqual(MAX_SPREADSHEET_STRING_PAYLOAD_BYTES);
    expect(sheet.budget.truncated).toBe(true);
    expect(sheet.rows.length).toBeGreaterThan(0);
    expect(sheet.rows.length).toBeLessThan(220);
    expect(sheet.truncatedRows).toBe(true);
    expect(estimateNormalizedStringPayloadBytes(result.sheets))
      .toBeLessThanOrEqual(result.budget.stringPayloadBytes);
  }, 30_000);
});

describe("spreadsheet preview interaction geometry", () => {
  it("virtualizes variable row heights without drifting", () => {
    const rows = [20, 28, 44, 32].map((height, rowIndex) => ({
      rowIndex,
      values: [String(rowIndex)],
      kinds: ["number" as const],
      formulas: [null],
      styleIds: [0],
      height,
    }));
    const offsets = getSpreadsheetRowOffsets(rows);
    const window = getSpreadsheetVisibleRowWindow({
      rowOffsets: offsets,
      scrollTop: 48,
      viewportHeight: 44,
      frozenRows: 1,
      overscanRows: 0,
    });

    expect(offsets).toEqual([0, 20, 48, 92, 124]);
    expect(window).toEqual({
      startRow: 2,
      endRow: 4,
      topSpacerHeight: 28,
      bottomSpacerHeight: 0,
    });
  });

  it("supports familiar read-only worksheet keyboard selection", () => {
    expect(getSpreadsheetNavigationTarget({
      key: "ArrowRight",
      selection: { rowPosition: 1, columnPosition: 1 },
      rowCount: 10,
      columnCount: 4,
      pageRows: 5,
    })).toEqual({ rowPosition: 1, columnPosition: 2 });
    expect(getSpreadsheetNavigationTarget({
      key: "PageDown",
      selection: { rowPosition: 7, columnPosition: 2 },
      rowCount: 10,
      columnCount: 4,
      pageRows: 5,
    })).toEqual({ rowPosition: 9, columnPosition: 2 });
    expect(getSpreadsheetNavigationTarget({
      key: "End",
      selection: { rowPosition: 0, columnPosition: 0 },
      rowCount: 10,
      columnCount: 4,
      pageRows: 5,
    })).toEqual({ rowPosition: 0, columnPosition: 3 });
    expect(getSpreadsheetNavigationTarget({
      key: "ArrowRight",
      selection: { rowPosition: 0, columnPosition: 0 },
      rowCount: 4,
      columnCount: 4,
      pageRows: 2,
      merges: [{
        startRow: 0,
        endRow: 0,
        startColumn: 0,
        endColumn: 2,
        value: "Title",
        kind: "text",
        formula: null,
        styleId: 0,
      }],
    })).toEqual({ rowPosition: 0, columnPosition: 3 });
  });
});

describe("spreadsheet preview worker client", () => {
  it("terminates the worker when its AbortSignal is cancelled", async () => {
    const worker = new FakeWorker();
    vi.stubGlobal("Worker", class {
      onmessage = worker.onmessage;
      onerror = worker.onerror;
      onmessageerror = worker.onmessageerror;
      postMessage = worker.postMessage;
      terminate = worker.terminate;
    } as unknown as typeof Worker);
    const controller = new AbortController();
    const parsing = parseSpreadsheetInWorker(new ArrayBuffer(8), {
      archiveKind: "none",
      signal: controller.signal,
    });
    const rejection = expect(parsing).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    controller.abort();

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates an unresponsive worker at the default hard timeout", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    stubWorker(worker);
    const parsing = parseSpreadsheetInWorker(new ArrayBuffer(8), { archiveKind: "none" });
    const rejection = expect(parsing).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(DEFAULT_SPREADSHEET_WORKER_TIMEOUT_MS);

    await rejection;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

function stubWorker(worker: FakeWorker): void {
  vi.stubGlobal("Worker", class {
    onmessage = worker.onmessage;
    onerror = worker.onerror;
    onmessageerror = worker.onmessageerror;
    postMessage = worker.postMessage;
    terminate = worker.terminate;
  } as unknown as typeof Worker);
}

function writeWorkbook(workbook: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx"): ArrayBuffer {
  return XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer;
}

async function createStyledWorkbookFixture(source: Uint8Array): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(source);
  const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetEntry) throw new Error("Test workbook is missing sheet1.xml.");
  const sheetXml = await sheetEntry.async("string");
  zip.file(
    "xl/worksheets/sheet1.xml",
    sheetXml
      .replace(
        '<sheetView workbookViewId="0"/>',
        '<sheetView workbookViewId="0" showGridLines="0" zoomScale="85"><pane ySplit="1" topLeftCell="A2" state="frozen"/><selection activeCell="B3" sqref="B3"/></sheetView>',
      )
      .replace('<c r="A1" t="str">', '<c r="A1" s="1" t="str">'),
  );
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2">
        <font><sz val="11"/><name val="Arial"/></font>
        <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
      </fonts>
      <fills count="3">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FF0B2545"/></patternFill></fill>
      </fills>
      <borders count="2">
        <border><left/><right/><top/><bottom/><diagonal/></border>
        <border>
          <left style="thin"><color rgb="FFD9E2EC"/></left>
          <right style="thin"><color rgb="FFD9E2EC"/></right>
          <top style="thin"><color rgb="FFD9E2EC"/></top>
          <bottom style="thin"><color rgb="FFD9E2EC"/></bottom>
          <diagonal/>
        </border>
      </borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="2">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
          <alignment horizontal="center" vertical="center" wrapText="1"/>
        </xf>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`,
  );
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function createSparseRangeSheet(reference: string): XLSX.WorkSheet {
  const range = XLSX.utils.decode_range(reference);
  const firstCell = XLSX.utils.encode_cell(range.s);
  const lastCell = XLSX.utils.encode_cell(range.e);
  return {
    [firstCell]: { t: "s", v: "start" },
    [lastCell]: { t: "s", v: "end" },
    "!ref": reference,
  };
}

function countNormalizedCellPayloads(
  sheets: Array<{ rows: Array<{ values: string[] }>; merges: unknown[] }>,
): number {
  return sheets.reduce((total, sheet) => (
    total
      + sheet.rows.reduce((rowTotal, row) => rowTotal + row.values.length, 0)
      + sheet.merges.length
  ), 0);
}

function estimateNormalizedStringPayloadBytes(
  sheets: Array<{ name: string; rows: Array<{ values: string[] }>; merges: Array<{ value: string }> }>,
): number {
  return sheets.reduce((total, sheet) => (
    total
      + (sheet.name.length * 2)
      + sheet.rows.reduce(
        (rowTotal, row) => rowTotal + row.values.reduce((cellTotal, value) => cellTotal + (value.length * 2), 0),
        0,
      )
      + sheet.merges.reduce((mergeTotal, merge) => mergeTotal + (merge.value.length * 2), 0)
  ), 0);
}

function patchDeclaredUncompressedSize(
  arrayBuffer: ArrayBuffer,
  entryName: string,
  declaredBytes: number,
): void {
  const view = new DataView(arrayBuffer);
  const eocdOffset = findSignatureFromEnd(view, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  if (eocdOffset < 0) throw new Error("EOCD not found in test archive.");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Malformed central directory in test archive.");
    }
    const nameBytes = view.getUint16(cursor + 28, true);
    const extraBytes = view.getUint16(cursor + 30, true);
    const commentBytes = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(new Uint8Array(arrayBuffer, cursor + 46, nameBytes));
    if (name === entryName) {
      const localOffset = view.getUint32(cursor + 42, true);
      view.setUint32(cursor + 24, declaredBytes, true);
      view.setUint32(localOffset + 22, declaredBytes, true);
      return;
    }
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  throw new Error(`Entry ${entryName} not found in test archive.`);
}

function findSignatureFromEnd(view: DataView, signature: number): number {
  for (let offset = view.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
