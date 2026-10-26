/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { createTableView, source, rect, mockRect, makeHandleCaptureSafe } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {
  it("defines stable semantic column tracks before a rich cell enters edit mode", () => {
    const view = createTableView([
      "| **Name** | Value |",
      "| --- | --- |",
      "| Alpha | Beta |",
    ].join("\n"));
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const columns = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup col"));
    const widths = columns.map((column) => column.style.width);
    const firstCell = table.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="0"][data-md-table-column="0"]',
    )!;

    expect(columns).toHaveLength(2);
    expect(widths.every((width) => /^\d+px$/.test(width))).toBe(true);

    firstCell.focus();
    expect(firstCell.textContent).toBe("**Name**");
    expect(Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup col"))
      .map((column) => column.style.width)).toEqual(widths);

    firstCell.blur();
    expect(Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup col"))
      .map((column) => column.style.width)).toEqual(widths);
  });

  it("fits automatic tracks to the reading column by content and auto-fits within it", () => {
    const view = createTableView([
      `| ${"wide ".repeat(80)} | B |`,
      "| --- | --- |",
      "| Alpha | Beta |",
    ].join("\n"));
    const widths = Array.from(
      view.dom.querySelectorAll<HTMLTableColElement>(".cm-md-table-widget colgroup col"),
      (column) => Number.parseInt(column.style.width, 10),
    );

    // Not a spreadsheet cap: the long column takes the reading column's spare
    // width (640px default, less the table rule) and the short one stays snug.
    expect(widths[0] + widths[1]).toBe(638);
    expect(widths[0]).toBeGreaterThan(500);
    expect(widths[1]).toBeLessThan(80);

    const firstHeader = view.dom.querySelector<HTMLTableCellElement>("thead th")!;
    firstHeader.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    view.dom.querySelector<HTMLElement>(".cm-md-table-column-resize-handle")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(view.dom.querySelector<HTMLTableColElement>(
      '.cm-md-table-widget col[data-md-table-column="0"]',
    )?.style.width).toBe("638px");

    const columnHandle = view.dom.querySelector<HTMLElement>(".cm-md-table-column-handle")!;
    makeHandleCaptureSafe(columnHandle);
    columnHandle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 30,
    }));
    columnHandle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 30,
    }));
    const menu = document.querySelector<HTMLElement>(".cm-md-table-context-menu")!;
    expect(menu.textContent).not.toMatch(/Auto fit column|Fit columns to viewport|Reset column widths/);
    expect(view.dom.querySelector<HTMLTableColElement>(
      '.cm-md-table-widget col[data-md-table-column="0"]',
    )?.style.width).toBe("638px");
  });

  it("lets a short table hug its content instead of stretching", () => {
    const view = createTableView([
      "| 字段 | 值 |",
      "| --- | --- |",
      "| Title | puppyone |",
    ].join("\n"));
    const widths = Array.from(
      view.dom.querySelectorAll<HTMLTableColElement>(".cm-md-table-widget colgroup col"),
      (column) => Number.parseInt(column.style.width, 10),
    );

    expect(widths).toHaveLength(2);
    expect(widths[0] + widths[1]).toBeLessThan(240);
  });

  it("keeps a user-resized track stable across content commits and reopening", () => {
    const view = createTableView();
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-table-surface")!;
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const firstHeader = table.querySelector<HTMLTableCellElement>("thead th")!;
    const firstColumn = table.querySelector<HTMLTableColElement>(
      'col[data-md-table-column="0"]',
    )!;
    const startWidth = Number.parseInt(firstColumn.style.width, 10);
    mockRect(surface, rect(0, 0, 320, 140));
    mockRect(table, rect(0, 20, 300, 110));
    mockRect(firstHeader, rect(0, 20, startWidth, 31));

    firstHeader.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const resizeHandle = view.dom.querySelector<HTMLElement>(
      ".cm-md-table-column-resize-handle",
    )!;
    expect(resizeHandle.classList.contains("is-visible")).toBe(true);
    makeHandleCaptureSafe(resizeHandle);
    resizeHandle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: startWidth,
      pointerId: 31,
    }));
    resizeHandle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: startWidth + 84,
      pointerId: 31,
    }));
    resizeHandle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      clientX: startWidth + 84,
      pointerId: 31,
    }));
    const resizedWidth = startWidth + 84;
    expect(firstColumn.style.width).toBe(`${resizedWidth}px`);

    const firstBodyCell = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-cell-content[data-md-table-row="1"][data-md-table-column="0"]',
    )!;
    firstBodyCell.focus();
    firstBodyCell.textContent = "a much longer value that must not resize the table geometry";
    firstBodyCell.dispatchEvent(new InputEvent("input", { bubbles: true }));
    firstBodyCell.blur();

    const replacementRoot = view.dom.querySelector<HTMLElement>(".cm-md-table-widget-wrap")!;
    expect(replacementRoot.dataset.mdTableColumnLayoutSession).toBeTruthy();
    expect(replacementRoot.querySelector<HTMLTableColElement>(
      'col[data-md-table-column="0"]',
    )?.style.width).toBe(`${resizedWidth}px`);

    const reopened = createTableView(source(view));
    expect(reopened.dom.querySelector<HTMLTableColElement>(
      '.cm-md-table-widget col[data-md-table-column="0"]',
    )?.style.width).toBe(`${resizedWidth}px`);
  });
});
