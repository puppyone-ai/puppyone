import { describe, expect, it, vi } from "vitest";
import {
  CSV_COLUMN_INITIAL_MAX_WIDTH,
  CsvColumnLayoutModel,
  fitCsvColumnWidths,
} from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvColumnLayoutModel";
import { CsvDocumentModel } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvDocumentModel";

describe("CSV column layout view state", () => {
  it("does not resize a column when cell content changes", () => {
    const document = new CsvDocumentModel("stable.csv", "Name,Score\nAda,1", ",");
    const layout = createLayout(document);
    const before = layout.getSnapshot();

    document.setCell(1, 0, "Ada Lovelace with a deliberately long display value");

    expect(layout.getSnapshot()).toBe(before);
    expect(layout.getSnapshot().widths).toEqual([96, 96]);
  });

  it("keeps widths with stable column identities through move, delete, and undo", () => {
    const document = new CsvDocumentModel("structure.csv", "Name,Score\nAda,1", ",");
    const write = vi.fn();
    const layout = createLayout(document, undefined, write);
    layout.setColumnWidth(0, 240);
    layout.commitColumnWidths();

    document.applyStructureOperation(true, {
      type: "move-column-right",
      rowIndex: 1,
      columnIndex: 0,
    });
    expect(layout.getSnapshot().widths).toEqual([96, 240]);

    document.applyStructureOperation(true, {
      type: "delete-column",
      rowIndex: 1,
      columnIndex: 1,
    });
    expect(layout.getSnapshot().widths).toEqual([96]);

    document.undo();
    expect(layout.getSnapshot().widths).toEqual([96, 240]);
    expect(write).toHaveBeenCalled();
  });

  it("restores compatible persisted widths without putting them in the CSV model", () => {
    const document = new CsvDocumentModel("persisted.csv", "Name,Score\nAda,1", ",");
    const layout = createLayout(document, [180, 260]);

    expect(layout.getSnapshot().widths).toEqual([180, 260]);
    expect(document.getSnapshot()).not.toHaveProperty("columnWidths");
  });

  it("caps only initial and reset widths while preserving an explicit user width", () => {
    const longValue = "x".repeat(100);
    const freshDocument = new CsvDocumentModel("fresh.csv", `Name\n${longValue}`, ",");
    const freshLayout = createLayout(freshDocument);
    expect(freshLayout.getSnapshot().widths).toEqual([CSV_COLUMN_INITIAL_MAX_WIDTH]);

    const restoredDocument = new CsvDocumentModel("restored.csv", `Name\n${longValue}`, ",");
    const restoredLayout = createLayout(restoredDocument, [420]);
    expect(restoredLayout.getSnapshot().widths).toEqual([420]);

    restoredLayout.resetColumnWidths();
    expect(restoredLayout.getSnapshot().widths).toEqual([CSV_COLUMN_INITIAL_MAX_WIDTH]);
  });

  it("fits proportionally when possible and preserves readable overflow below the minimum", () => {
    expect(fitCsvColumnWidths([100, 200], 600)).toEqual([200, 400]);
    expect(fitCsvColumnWidths([100, 200], 120)).toEqual([96, 96]);
    expect(fitCsvColumnWidths([500, 100], 1_400)).toEqual([560, 560]);
  });
});

function createLayout(
  document: CsvDocumentModel,
  restored?: readonly number[],
  write = vi.fn(),
) {
  return new CsvColumnLayoutModel(document, {
    read: () => restored,
    write,
  });
}
