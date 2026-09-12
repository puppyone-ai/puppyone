import { describe, expect, it } from "vitest";
import {
  EDITABLE_TABLE_COLUMN_MAX_WIDTH,
  EDITABLE_TABLE_COLUMN_MIN_WIDTH,
  estimateEditableTableColumnWidths,
} from "../../../../../packages/shared-ui/src/editor/table/editableTableLayout";

describe("editable table layout", () => {
  it("uses the same bounded visual-width model for CSV and Markdown cells", () => {
    const widths = estimateEditableTableColumnWidths(
      [
        ["short", "中文中文中文中文中文", "first\nabcdefghijklmnopqrst", "x".repeat(100)],
        ["", "", "", ""],
      ],
      5,
      (row) => row,
    );

    expect(widths).toEqual([
      EDITABLE_TABLE_COLUMN_MIN_WIDTH,
      168,
      168,
      EDITABLE_TABLE_COLUMN_MAX_WIDTH,
      EDITABLE_TABLE_COLUMN_MIN_WIDTH,
    ]);
  });

  it("samples a large document evenly and includes its final rows", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [
      index === 9_999 ? "z".repeat(100) : String(index),
    ]);
    let inspectedRows = 0;

    const widths = estimateEditableTableColumnWidths(rows, 1, (row) => {
      inspectedRows += 1;
      return row;
    });

    expect(inspectedRows).toBe(128);
    expect(widths).toEqual([EDITABLE_TABLE_COLUMN_MAX_WIDTH]);
  });
});
