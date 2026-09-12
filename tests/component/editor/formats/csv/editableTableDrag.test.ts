/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import {
  getEditableTableColumnDropBoundary,
  getEditableTableDropBoundary,
} from "../../../../../packages/shared-ui/src/editor/table/editableTableDrag";

describe("editable table drag boundaries", () => {
  it("uses cell midpoints for row boundaries", () => {
    const segments = [
      { boundary: 4, start: 100, size: 30 },
      { boundary: 5, start: 130, size: 30 },
    ];
    expect(getEditableTableDropBoundary(segments, 110)).toBe(4);
    expect(getEditableTableDropBoundary(segments, 144)).toBe(5);
    expect(getEditableTableDropBoundary(segments, 170)).toBe(6);
  });

  it("mirrors column boundary detection for RTL", () => {
    const cells = [mockCell(100, 90), mockCell(190, 90)];
    expect(getEditableTableColumnDropBoundary(cells, 120, "ltr")).toBe(0);
    expect(getEditableTableColumnDropBoundary(cells, 250, "ltr")).toBe(2);
    expect(getEditableTableColumnDropBoundary(cells, 180, "rtl")).toBe(0);
    expect(getEditableTableColumnDropBoundary(cells, 80, "rtl")).toBe(2);
  });
});

function mockCell(left: number, width: number): HTMLTableCellElement {
  const cell = document.createElement("td");
  Object.defineProperty(cell, "getBoundingClientRect", {
    value: () => ({
      bottom: 30,
      height: 30,
      left,
      right: left + width,
      top: 0,
      width,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  return cell;
}
