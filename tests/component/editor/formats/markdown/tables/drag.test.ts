/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { createTableView, source, rect, mockRect, makeHandleCaptureSafe } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {

  it("moves a column with the pointer drag handle", () => {
    const view = createTableView();
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-table-surface")!;
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    mockRect(surface, rect(0, 0, 300, 140));
    mockRect(table, rect(0, 20, 300, 110));
    headers.forEach((header, index) => mockRect(header, rect(index * 100, 20, 100, 30)));

    headers[0]?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const handle = view.dom.querySelector<HTMLElement>(".cm-md-table-column-handle")!;
    expect(handle.querySelector(".cm-md-table-drag-handle-visual")).not.toBeNull();
    makeHandleCaptureSafe(handle);
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 50,
      clientY: 10,
      pointerId: 11,
    }));
    handle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: 280,
      clientY: 10,
      pointerId: 11,
    }));
    expect(() => handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: 280,
      clientY: 10,
      pointerId: 11,
    }))).not.toThrow();

    expect(source(view).split("\n")[0]).toMatch(/^\| B\s+\| C\s+\| A\s+\|$/);
  });

  it("moves a body row with the pointer drag handle", () => {
    const view = createTableView();
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-table-surface")!;
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const bodyRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    mockRect(surface, rect(0, 0, 300, 140));
    mockRect(table, rect(0, 20, 300, 110));
    bodyRows.forEach((row, index) => mockRect(row, rect(0, 50 + index * 30, 300, 30)));

    bodyRows[0]?.cells[0]?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const handle = view.dom.querySelector<HTMLElement>(".cm-md-table-row-handle")!;
    makeHandleCaptureSafe(handle);
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 0,
      clientY: 65,
      pointerId: 12,
    }));
    expect(Array.from(bodyRows[0]!.cells).every((cell) => (
      cell.classList.contains("cm-md-table-drag-source")
    ))).toBe(true);
    handle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: 0,
      clientY: 110,
      pointerId: 12,
    }));
    expect(() => handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: 0,
      clientY: 110,
      pointerId: 12,
    }))).not.toThrow();

    expect(source(view).split("\n")[2]).toMatch(/^\| four\s+\| five\s+\| six\s+\|$/);
    expect(source(view).split("\n")[3]).toMatch(/^\| one\s+\| two\s+\| three\s+\|$/);
  });
});
