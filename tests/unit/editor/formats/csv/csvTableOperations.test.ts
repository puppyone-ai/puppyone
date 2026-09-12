import { describe, expect, it } from "vitest";
import { applyCsvTableOperation } from "../../../../../packages/shared-ui/src/editor/viewers/csv/csvTableOperations";

describe("CSV table structural operations", () => {
  it("keeps the header fixed while rows move through commands and direct drops", () => {
    const rows = [
      ["Name", "Score"],
      ["Ada", "1"],
      ["Lin", "2"],
    ];

    expect(applyCsvTableOperation(rows, true, {
      type: "move-row-up",
      rowIndex: 1,
      columnIndex: 0,
    }).rows).toEqual(rows);
    expect(applyCsvTableOperation(rows, true, {
      type: "delete-row",
      rowIndex: 0,
      columnIndex: 0,
    }).rows).toEqual(rows);

    const moved = applyCsvTableOperation(rows, true, {
      type: "move-row-to",
      rowIndex: 2,
      columnIndex: 1,
      targetRowIndex: 1,
    });
    expect(moved).toEqual({
      rows: [
        ["Name", "Score"],
        ["Lin", "2"],
        ["Ada", "1"],
      ],
      focus: { rowIndex: 1, columnIndex: 1 },
    });
  });

  it("inserts, duplicates, and deletes body rows without mutating the source", () => {
    const rows = [["Header"], ["one"], ["two"]];
    const inserted = applyCsvTableOperation(rows, true, {
      type: "insert-row-above",
      rowIndex: 1,
      columnIndex: 0,
    });
    const duplicated = applyCsvTableOperation(inserted.rows, true, {
      type: "duplicate-row",
      rowIndex: 2,
      columnIndex: 0,
    });
    const deleted = applyCsvTableOperation(duplicated.rows, true, {
      type: "delete-row",
      rowIndex: 1,
      columnIndex: 0,
    });

    expect(rows).toEqual([["Header"], ["one"], ["two"]]);
    expect(inserted.rows).toEqual([["Header"], [""], ["one"], ["two"]]);
    expect(duplicated.rows).toEqual([["Header"], [""], ["one"], ["one"], ["two"]]);
    expect(deleted.rows).toEqual([["Header"], ["one"], ["one"], ["two"]]);
  });

  it("moves and edits whole columns as one structural operation", () => {
    const rows = [["A", "B", "C"], ["1", "2", "3"]];
    const moved = applyCsvTableOperation(rows, false, {
      type: "move-column-to",
      rowIndex: 0,
      columnIndex: 2,
      targetColumnIndex: 0,
    });
    expect(moved).toEqual({
      rows: [["C", "A", "B"], ["3", "1", "2"]],
      focus: { rowIndex: 0, columnIndex: 0 },
    });

    const inserted = applyCsvTableOperation(moved.rows, false, {
      type: "insert-column-right",
      rowIndex: 1,
      columnIndex: 1,
    });
    expect(inserted.rows).toEqual([["C", "A", "", "B"], ["3", "1", "", "2"]]);

    const deleted = applyCsvTableOperation(inserted.rows, false, {
      type: "delete-column",
      rowIndex: 1,
      columnIndex: 2,
    });
    expect(deleted.rows).toEqual(moved.rows);
  });

  it("turns deletion of the only non-header row into an editable blank row", () => {
    expect(applyCsvTableOperation([["value"]], false, {
      type: "delete-row",
      rowIndex: 0,
      columnIndex: 0,
    })).toEqual({ rows: [[""]], focus: { rowIndex: 0, columnIndex: 0 } });
  });

  it("expands rows and columns atomically without allowing inward data loss", () => {
    const source = [["Name", "Score"], ["Ada", "1"]];
    const expanded = applyCsvTableOperation(source, true, {
      type: "expand-to-shape",
      rowIndex: 1,
      columnIndex: 1,
      targetDataRowCount: 4,
      targetColumnCount: 5,
    });

    expect(source).toEqual([["Name", "Score"], ["Ada", "1"]]);
    expect(expanded).toEqual({
      rows: [
        ["Name", "Score", "", "", ""],
        ["Ada", "1", "", "", ""],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
      ],
      focus: { rowIndex: 2, columnIndex: 2 },
    });

    expect(applyCsvTableOperation(expanded.rows, true, {
      type: "expand-to-shape",
      rowIndex: 1,
      columnIndex: 1,
      targetDataRowCount: 1,
      targetColumnCount: 1,
    }).rows).toEqual(expanded.rows);
  });
});
