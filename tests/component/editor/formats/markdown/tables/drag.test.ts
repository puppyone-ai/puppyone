/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { createTableView, source, nextAnimationFrame, rect, mockRect, makeHandleCaptureSafe } from "../../../../../support/editor/markdown/tableInteractions";

describe("Markdown table EditorView interactions", () => {
  it.each(["pointercancel", "Escape", "lostpointercapture", "blur"])(
    "clears pressed and drag highlighting on %s without opening a menu or editing source",
    (reason) => {
      for (const axis of ["column", "row"]) {
        for (const moved of [false, true]) {
          const view = createTableView();
          const original = source(view);
          view.dom.querySelector<HTMLElement>("tbody td")!
            .dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
          const handle = view.dom.querySelector<HTMLElement>(`.cm-md-table-${axis}-handle`)!;
          const outline = view.dom.querySelector<HTMLElement>(".po-editable-table-selection-outline")!;
          makeHandleCaptureSafe(handle);
          handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 41 }));
          expect(handle.classList.contains("is-pressed")).toBe(true);
          expect(outline.hidden).toBe(false);
          // A second pointer must not move or finish the captured interaction.
          for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
            handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 42, clientX: 30 }));
          }
          expect(handle.classList.contains("is-pressed")).toBe(true);
          expect(handle.classList.contains("is-dragging")).toBe(false);
          if (moved) {
            handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 41, clientX: 30 }));
            expect(handle.classList.contains("is-dragging")).toBe(true);
            expect(handle.classList.contains("is-pressed")).toBe(true);
          }
          if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
          else if (reason === "blur") window.dispatchEvent(new Event("blur"));
          else handle.dispatchEvent(new PointerEvent(reason, { bubbles: true, pointerId: 41 }));
          expect(handle.classList.contains("is-pressed")).toBe(false);
          expect(handle.classList.contains("is-dragging")).toBe(false);
          expect(outline.hidden).toBe(true);
          expect(view.dom.querySelector(".po-editable-table-drag-source")).toBeNull();
          handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 41 }));
          expect(document.querySelector(".cm-md-table-context-menu")).toBeNull();
          expect(source(view)).toBe(original);
        }
      }
    },
  );

  it("keeps the moved column structurally selected without focusing its first cell", async () => {
    const view = createTableView();
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-table-surface")!;
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    mockRect(surface, rect(0, 0, 300, 140));
    mockRect(table, rect(0, 20, 300, 110));
    headers.forEach((header, index) => mockRect(header, rect(index * 100, 20, 100, 30)));

    headers[0]?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const focusSentinel = document.createElement("button");
    document.body.appendChild(focusSentinel);
    focusSentinel.focus();
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
    expect(handle.classList.contains("is-pressed")).toBe(true);
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

    await nextAnimationFrame();
    await nextAnimationFrame();
    expect(handle.classList.contains("is-pressed")).toBe(false);
    expect(handle.classList.contains("is-dragging")).toBe(false);
    expect(document.activeElement).toBe(focusSentinel);
    expect(view.dom.querySelector(".cm-md-table-cell-content:focus")).toBeNull();
    const outline = view.dom.querySelector<HTMLElement>(".po-editable-table-selection-outline")!;
    const selectedColumn = view.dom.querySelector<HTMLTableCellElement>(
      "thead .po-editable-table-selection-target",
    );
    expect(outline.hidden).toBe(false);
    expect(outline.dataset.axis).toBe("column");
    expect(selectedColumn?.getAttribute("aria-colindex")).toBe("3");
    expect(selectedColumn?.textContent).toContain("A");
    expect(source(view).split("\n")[0]).toMatch(/^\| B\s+\| C\s+\| A\s+\|$/);

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await nextAnimationFrame();
    expect(outline.hidden).toBe(true);
  });

  it("keeps the moved body row structurally selected without focusing its first cell", async () => {
    const view = createTableView();
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-table-surface")!;
    const table = view.dom.querySelector<HTMLTableElement>(".cm-md-table-widget")!;
    const bodyRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    mockRect(surface, rect(0, 0, 300, 140));
    mockRect(table, rect(0, 20, 300, 110));
    bodyRows.forEach((row, index) => mockRect(row, rect(0, 50 + index * 30, 300, 30)));

    bodyRows[0]?.cells[0]?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const focusSentinel = document.createElement("button");
    document.body.appendChild(focusSentinel);
    focusSentinel.focus();
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

    await nextAnimationFrame();
    await nextAnimationFrame();
    expect(handle.classList.contains("is-pressed")).toBe(false);
    expect(handle.classList.contains("is-dragging")).toBe(false);
    expect(document.activeElement).toBe(focusSentinel);
    expect(view.dom.querySelector(".cm-md-table-cell-content:focus")).toBeNull();
    const outline = view.dom.querySelector<HTMLElement>(".po-editable-table-selection-outline")!;
    const selectedRow = view.dom.querySelector<HTMLTableRowElement>(
      "tbody .po-editable-table-selection-target",
    );
    expect(outline.hidden).toBe(false);
    expect(outline.dataset.axis).toBe("row");
    expect(selectedRow?.dataset.mdTableRow).toBe("2");
    expect(selectedRow?.textContent).toContain("one");
    expect(source(view).split("\n")[2]).toMatch(/^\| four\s+\| five\s+\| six\s+\|$/);
    expect(source(view).split("\n")[3]).toMatch(/^\| one\s+\| two\s+\| three\s+\|$/);

    selectedRow?.cells[0]?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(outline.hidden).toBe(true);
  });
});
