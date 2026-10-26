import { describe, expect, it } from "vitest";
import {
  estimateMarkdownTableColumnWidth,
  fitMarkdownTableColumnWidths,
  layoutMarkdownTableColumns,
  measureCellText,
  measureMarkdownTableColumns,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/markdownTableColumnLayout";
import type { MarkdownTableRow } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableModel";

// 600px usable; estimates carry 6% slack, so 1em of text is 10.6px here.
const metrics = { availableWidth: 602, emPx: 10, cellInset: 20 } as const;

function rows(...table: string[][]): MarkdownTableRow[] {
  return table.map((cells, index) => ({
    header: index === 0,
    lineTo: index,
    cells: cells.map((text, column) => ({ text, from: column, to: column, editable: true })),
  })) as unknown as MarkdownTableRow[];
}

describe("Markdown table column layout", () => {
  it("hugs its content when every column fits on one line", () => {
    const widths = layoutMarkdownTableColumns(
      [{ minEm: 2, maxEm: 4 }, { minEm: 3, maxEm: 10 }],
      metrics,
    );
    expect(widths).toEqual([63, 126]);
  });

  it("keeps a short label column whole and gives the long column the rest of the row", () => {
    const widths = layoutMarkdownTableColumns(
      [{ minEm: 1, maxEm: 8 }, { minEm: 6, maxEm: 66 }],
      metrics,
    );
    // The 105px label column stays on one line instead of being squeezed to
    // its minimum; the long column fills the remaining 495px.
    expect(widths).toEqual([105, 495]);
  });

  it("fills the reading column in proportion to how much each long column would still grow", () => {
    const widths = layoutMarkdownTableColumns(
      [{ minEm: 6, maxEm: 30 }, { minEm: 6, maxEm: 66 }],
      metrics,
    );
    // Minimums 84 + 84, natural 338 + 720: the spare 432px is shared 254 : 636.
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(600);
    expect(widths).toEqual([207, 393]);
  });

  it("keeps every column at its readable minimum and scrolls when even those do not fit", () => {
    const widths = layoutMarkdownTableColumns(
      Array.from({ length: 12 }, () => ({ minEm: 5, maxEm: 20 })),
      metrics,
    );
    expect(widths).toEqual(Array(12).fill(73));
  });

  it("never lets one long word claim more than 30% of a crowded row as its minimum", () => {
    const [url, ...others] = layoutMarkdownTableColumns(
      [{ minEm: 200, maxEm: 200 }, ...Array.from({ length: 3 }, () => ({ minEm: 15, maxEm: 30 }))],
      metrics,
    );
    // Minimums (180 + 3 × 179) already exceed 600px: the table scrolls, and
    // the URL wraps at 30% of the row instead of demanding its full width.
    expect(url).toBe(180);
    expect(others).toEqual([179, 179, 179]);
  });

  it("measures what a reader sees, not Markdown syntax", () => {
    const plain = measureCellText("Context Base");
    expect(measureCellText("**Context Base**")).toEqual(plain);
    expect(measureCellText("[Context Base](https://example.com/a/very/long/target)")).toEqual(plain);
    // Wide characters set at one em and each may start a line.
    expect(measureCellText("上下文")).toEqual({ minEm: 1, maxEm: 3 });
    // Paths break after slashes; inline code is set in the monospace face.
    expect(measureCellText("`/en/context-base`").minEm).toBeCloseTo(0.6 * "context-".length, 5);
    expect(measureCellText("one<br>two words").maxEm).toBeGreaterThan(measureCellText("one").maxEm);
  });

  it("sizes columns from their widest cell, headers slightly bolder", () => {
    const [field, value] = measureMarkdownTableColumns(rows(["字段", "值"], ["Title", "puppyone"]), 2);
    expect(field.maxEm).toBeGreaterThanOrEqual(2);
    expect(value.maxEm).toBeGreaterThan(field.maxEm);
  });

  it("auto-fits one column to its natural width within the reading column", () => {
    const table = rows(["A", "B"], ["short", "x".repeat(400)]);
    expect(estimateMarkdownTableColumnWidth(table, 1, metrics)).toBe(600);
    expect(estimateMarkdownTableColumnWidth(table, 0, metrics)).toBeLessThan(100);
  });

  it("fits explicit tracks onto the reading column proportionally", () => {
    expect(fitMarkdownTableColumnWidths([100, 300], 402)).toEqual([100, 300]);
    expect(fitMarkdownTableColumnWidths([200, 600], 402)).toEqual([100, 300]);
  });
});
