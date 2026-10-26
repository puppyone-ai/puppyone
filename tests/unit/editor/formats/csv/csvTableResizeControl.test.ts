import { describe, expect, it } from "vitest";
import {
  getCsvTableExpansionFromDrag,
  getCsvTableResizeViewportConstraints,
  getCsvExpansionEdgeVelocity,
} from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableResizeControl";

describe("CSV table corner resize geometry", () => {
  it("snaps outward distance to the nearest complete row and column", () => {
    expect(getCsvTableExpansionFromDrag({
      horizontalDistance: 193,
      verticalDistance: 63,
      rowHeight: 31,
      columnWidth: 96,
      maximumAddedRows: 100,
      maximumAddedColumns: 100,
    })).toEqual({ addedRows: 2, addedColumns: 2 });
  });

  it("does not preview the first track until the pointer crosses its midpoint", () => {
    const base = {
      rowHeight: 31,
      columnWidth: 96,
      maximumAddedRows: 100,
      maximumAddedColumns: 100,
    };
    expect(getCsvTableExpansionFromDrag({
      ...base,
      horizontalDistance: 47,
      verticalDistance: 15,
    })).toEqual({ addedRows: 0, addedColumns: 0 });
    expect(getCsvTableExpansionFromDrag({
      ...base,
      horizontalDistance: 48,
      verticalDistance: 16,
    })).toEqual({ addedRows: 1, addedColumns: 1 });
  });

  it("never turns inward movement into a shrinking operation", () => {
    expect(getCsvTableExpansionFromDrag({
      horizontalDistance: -200,
      verticalDistance: -200,
      rowHeight: 31,
      columnWidth: 96,
      maximumAddedRows: 100,
      maximumAddedColumns: 100,
    })).toEqual({ addedRows: 0, addedColumns: 0 });
  });

  it("clamps expansion to the remaining safety budget", () => {
    expect(getCsvTableExpansionFromDrag({
      horizontalDistance: 10000,
      verticalDistance: 10000,
      rowHeight: 31,
      columnWidth: 96,
      maximumAddedRows: 4,
      maximumAddedColumns: 2,
    })).toEqual({ addedRows: 4, addedColumns: 2 });
  });

  it("caps rows to the viewport but lets columns grow past its edge", () => {
    expect(getCsvTableResizeViewportConstraints({
      editorRect: { bottom: 670, left: 80, right: 880, top: 70 },
      maximumAddedColumns: 100,
      maximumAddedRows: 100,
      rowHeight: 31,
      surfaceRect: { bottom: 193, left: 100, right: 323, top: 100 },
    })).toEqual({
      maximumAddedColumns: 100,
      maximumAddedRows: 15,
      pointerBounds: { bottom: 670, left: 80, right: 880, top: 70 },
    });
  });

  it("does not block column growth when the existing table already fills the viewport", () => {
    expect(getCsvTableResizeViewportConstraints({
      editorRect: { bottom: 600, left: 0, right: 800, top: 0 },
      maximumAddedColumns: 100,
      maximumAddedRows: 100,
      rowHeight: 31,
      surfaceRect: { bottom: 197, left: 0, right: 800, top: 104 },
    })).toMatchObject({
      maximumAddedColumns: 100,
      maximumAddedRows: 13,
    });
  });

  it("scrolls only at the outward edge, with bounded speed and mirrored RTL behavior", () => {
    const viewport = { left: 100, right: 500, top: 0, bottom: 300 };
    expect(getCsvExpansionEdgeVelocity(300, viewport, "ltr")).toBe(0);
    expect(getCsvExpansionEdgeVelocity(476, viewport, "ltr")).toBe(300);
    expect(getCsvExpansionEdgeVelocity(510, viewport, "ltr")).toBe(600);
    expect(getCsvExpansionEdgeVelocity(10_000, viewport, "ltr")).toBe(600);
    expect(getCsvExpansionEdgeVelocity(124, viewport, "rtl")).toBe(300);
    expect(getCsvExpansionEdgeVelocity(90, viewport, "rtl")).toBe(600);
    expect(getCsvExpansionEdgeVelocity(300, viewport, "rtl")).toBe(0);
  });
});
