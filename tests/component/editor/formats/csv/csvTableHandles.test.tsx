/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { withTestLocalization } from "../../../../support/react/localization";
import { Harness, changeCount, container, findButton, latestSnapshot, makePointerCaptureSafe, mockRect, mockTableGeometry, pointerEvent, rect, remount, setUpCsvTable, unmountRoot } from "../../../../support/editor/csvTableHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpCsvTable();

describe("CSV table: handles, menus and resizing", () => {
  it("resizes a column as persistent view state without changing CSV content", async () => {
    const geometry = mockTableGeometry();
    const originalSnapshot = latestSnapshot;
    const originalChangeCount = changeCount;
    act(() => geometry.firstBodyCell.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    ));
    const resizeHandle = container?.querySelector<HTMLButtonElement>(
      ".csv-table-editor__column-resize-handle",
    );
    if (!resizeHandle) throw new Error("CSV column resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 227, 116, 41));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 307, 116, 41));
      resizeHandle.dispatchEvent(pointerEvent("pointerup", 307, 116, 41));
      await Promise.resolve();
    });

    const firstColumn = container?.querySelector<HTMLTableColElement>(
      ".csv-table-editor__table colgroup col:not(.csv-table-editor__record-index-column)",
    );
    expect(firstColumn?.style.width).toBe("176px");
    expect(latestSnapshot).toBe(originalSnapshot);
    expect(changeCount).toBe(originalChangeCount);

    await act(async () => {
      remount(withTestLocalization(<Harness />));
      await Promise.resolve();
    });
    expect(container?.querySelector<HTMLTableColElement>(
      ".csv-table-editor__table colgroup col:not(.csv-table-editor__record-index-column)",
    )?.style.width).toBe("176px");
  });

  it.each(["pointercancel", "Escape", "lostpointercapture", "blur"])(
    "clears pressed and drag highlighting on %s without changing CSV or opening a menu",
    (reason) => {
      const geometry = mockTableGeometry();
      const original = latestSnapshot;
      for (const axis of ["column", "row"]) {
        for (const moved of [false, true]) {
          act(() => geometry.firstBodyCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
          const handle = container!.querySelector<HTMLButtonElement>(`.csv-table-editor__${axis}-handle`)!;
          const outline = container!.querySelector<HTMLElement>(".po-editable-table-selection-outline")!;
          makePointerCaptureSafe(handle);
          act(() => handle.dispatchEvent(pointerEvent("pointerdown", 118, 145, 41)));
          expect(handle.classList.contains("is-pressed")).toBe(true);
          expect(outline.hidden).toBe(false);
          act(() => {
            for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
              handle.dispatchEvent(pointerEvent(type, 180, 181, 42));
            }
          });
          expect(handle.classList.contains("is-pressed")).toBe(true);
          expect(handle.classList.contains("is-dragging")).toBe(false);
          if (moved) {
            act(() => handle.dispatchEvent(pointerEvent("pointermove", 180, 181, 41)));
            expect(handle.classList.contains("is-dragging")).toBe(true);
            expect(handle.classList.contains("is-pressed")).toBe(true);
          }
          act(() => {
            if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            else if (reason === "blur") window.dispatchEvent(new Event("blur"));
            else handle.dispatchEvent(pointerEvent(reason, 180, 181, 41));
          });
          expect(handle.classList.contains("is-pressed")).toBe(false);
          expect(handle.classList.contains("is-dragging")).toBe(false);
          expect(outline.hidden).toBe(true);
          act(() => handle.dispatchEvent(pointerEvent("pointerup", 180, 181, 41)));
          expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
          expect(latestSnapshot).toBe(original);
          expect(changeCount).toBe(0);
        }
      }
    },
  );

  it.each(["column", "row"])("cleans up a pressed %s handle when its provider unmounts", (axis) => {
    const geometry = mockTableGeometry();
    act(() => geometry.firstBodyCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const handle = container!.querySelector<HTMLButtonElement>(`.csv-table-editor__${axis}-handle`)!;
    makePointerCaptureSafe(handle);
    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 118, 145, 41)));
    expect(handle.classList.contains("is-pressed")).toBe(true);
    const removeHandleListener = vi.spyOn(handle, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    act(() => unmountRoot());
    expect(handle.classList.contains("is-pressed")).toBe(false);
    expect(removeHandleListener).toHaveBeenCalledWith("lostpointercapture", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
    expect(changeCount).toBe(0);
  });

  it("opens a row-scoped menu from the same hover handle used for dragging", async () => {
    const geometry = mockTableGeometry();
    act(() => geometry.firstRecordIndexCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const rowHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__row-handle");
    if (!rowHandle) throw new Error("CSV row handle did not mount.");
    makePointerCaptureSafe(rowHandle);
    mockRect(rowHandle.querySelector(".po-editable-table-drag-handle-visual")!, rect(92, 134, 13, 26));
    expect(rowHandle.classList.contains("is-visible")).toBe(true);
    expect(rowHandle.getAttribute("aria-label")).toBe("Actions for row 1");
    expect(rowHandle.style.left).toBe("0px");
    expect(geometry.firstRecordIndexCell.querySelector(".csv-table-editor__record-index-label")?.textContent)
      .toBe("1");

    await act(async () => {
      rowHandle.dispatchEvent(pointerEvent("pointerdown", 98, 145, 7));
      expect(rowHandle.classList.contains("is-pressed")).toBe(true);
      expect(container?.querySelector<HTMLElement>(".po-editable-table-selection-outline")?.hidden).toBe(false);
      rowHandle.dispatchEvent(pointerEvent("pointerup", 98, 145, 7));
      await Promise.resolve();
    });

    const menu = document.querySelector(".csv-table-editor__context-menu");
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    expect(rowHandle.getAttribute("aria-expanded")).toBe("true");
    expect(rowHandle.classList.contains("is-pressed")).toBe(false);
    expect(rowHandle.classList.contains("is-menu-active")).toBe(true);
    expect((menu as HTMLElement).style.left).toBe("92px");
    expect((menu as HTMLElement).style.top).toBe("164px");

    const moveDown = findButton("Move row down");
    await act(async () => {
      moveDown?.click();
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Name,Score\nLin,2\nAda,1");
    expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
    expect(container?.querySelector("input:focus")).toBeNull();
    expect(container?.querySelector<HTMLElement>(".po-editable-table-selection-target")?.dataset.csvRow).toBe("2");
  });

  it("docks the row handle inside the frozen gutter before the viewport clips it", () => {
    const geometry = mockTableGeometry();
    const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
    const surface = container?.querySelector<HTMLElement>(".csv-table-editor__surface");
    const rowHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__row-handle");
    if (!scrollContainer || !surface || !rowHandle) {
      throw new Error("CSV row handle geometry did not mount.");
    }

    mockRect(scrollContainer, rect(100, 70, 800, 600));
    mockRect(geometry.firstRecordIndexCell, rect(100, 131, 31, 31));
    act(() => geometry.firstRecordIndexCell.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    ));

    expect(rowHandle.classList.contains("is-visible")).toBe(true);
    expect(rowHandle.classList.contains("is-inline-docked")).toBe(true);
    expect(geometry.firstRecordIndexCell.hasAttribute("data-row-handle-docked")).toBe(true);

    act(() => surface.dispatchEvent(new PointerEvent("pointerleave")));
    expect(rowHandle.classList.contains("is-inline-docked")).toBe(false);
    expect(geometry.firstRecordIndexCell.hasAttribute("data-row-handle-docked")).toBe(false);
  });

  it("docks the column handle inside a sticky header before the viewport clips it", () => {
    const geometry = mockTableGeometry();
    const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
    const surface = container?.querySelector<HTMLElement>(".csv-table-editor__surface");
    const columnHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__column-handle");
    if (!scrollContainer || !surface || !columnHandle) {
      throw new Error("CSV column handle geometry did not mount.");
    }

    act(() => geometry.firstBodyCell.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    ));
    expect(columnHandle.classList.contains("is-visible")).toBe(true);
    expect(columnHandle.classList.contains("is-block-docked")).toBe(false);
    expect(geometry.firstHeaderCell.hasAttribute("data-column-handle-docked")).toBe(false);

    mockRect(surface, rect(100, 0, 223, 193));
    mockRect(geometry.firstHeaderCell, rect(131, 70, 96, 31));
    act(() => scrollContainer.dispatchEvent(new Event("scroll")));

    expect(columnHandle.classList.contains("is-block-docked")).toBe(true);
    expect(geometry.firstHeaderCell.hasAttribute("data-column-handle-docked")).toBe(true);

    act(() => surface.dispatchEvent(new PointerEvent("pointerleave")));
    expect(columnHandle.classList.contains("is-block-docked")).toBe(false);
    expect(geometry.firstHeaderCell.hasAttribute("data-column-handle-docked")).toBe(false);
  });

  it("opens the complete row and column operation set from a cell context menu", async () => {
    const geometry = mockTableGeometry();
    await act(async () => {
      geometry.firstBodyCell.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 142,
      }));
      await Promise.resolve();
    });

    const menu = document.querySelector(".csv-table-editor__context-menu");
    expect(menu?.querySelectorAll(".desktop-menu-section")).toHaveLength(3);
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(12);
    expect(menu?.querySelectorAll(".desktop-menu-item.is-icon")).toHaveLength(12);
    expect(menu?.querySelectorAll(".po-editable-table-menu-icon")).toHaveLength(12);
    expect(Array.from(menu?.querySelectorAll<HTMLButtonElement>(".desktop-menu-item") ?? [])
      .every((button) => Boolean(button.dataset.tooltip) && button.dataset.tooltip === button.getAttribute("aria-label"))).toBe(true);
    expect(findButton("Auto fit column")).not.toBeNull();
    const moveColumnRight = findButton("Move column right");
    await act(async () => {
      moveColumnRight?.click();
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Score,Name\n1,Ada\n2,Lin");
  });

  it("keeps header cells column-scoped instead of showing disabled row actions", async () => {
    const geometry = mockTableGeometry();
    await act(async () => {
      geometry.firstHeaderCell.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 168,
        clientY: 116,
      }));
      await Promise.resolve();
    });

    const menu = document.querySelector(".csv-table-editor__context-menu");
    expect(menu?.querySelectorAll(".desktop-menu-section")).toHaveLength(2);
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    expect(menu?.querySelector(".desktop-menu-section-label")).toBeNull();
    expect(menu?.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Columns");
    expect(findButton("Insert row below")).toBeNull();
  });

  it.each([
    ["row", 1, 0, "Move row down", 2, "Ada"],
    ["row", 2, 0, "Move row up", 1, "Lin"],
    ["column", 0, 0, "Move column right", 1, "Name"],
    ["column", 0, 1, "Move column left", 0, "Score"],
  ] as const)("keeps the whole %s selected after menu movement from row %s and column %s", async (axis, row, column, label, destination, text) => {
    mockTableGeometry();
    const cell = container!.querySelector<HTMLElement>(`[data-csv-row="${row}"][data-csv-column="${column}"]`)!;
    act(() => cell.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 160, clientY: 140,
    })));
    const menu = document.querySelector<HTMLElement>(".csv-table-editor__context-menu")!;
    expect(menu.querySelector(".desktop-menu-section-label")).toBeNull();
    await act(async () => findButton(label)!.click());
    expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
    expect(container!.querySelector("input:focus")).toBeNull();
    const outline = container!.querySelector<HTMLElement>(".po-editable-table-selection-outline")!;
    const target = container!.querySelector<HTMLElement>(".po-editable-table-selection-target")!;
    expect(outline.hidden).toBe(false);
    expect(outline.dataset.axis).toBe(axis);
    expect(axis === "row" ? target.dataset.csvRow : target.dataset.csvColumn).toBe(String(destination));
    expect(target.querySelector<HTMLInputElement>("input")!.value).toBe(text);
    expect(changeCount).toBe(1);
    act(() => target.querySelector<HTMLInputElement>("input")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(outline.hidden).toBe(true);
  });

  it("keeps dropped rows and columns structurally selected without focusing their first cell", async () => {
    let geometry = mockTableGeometry();
    const activeInput = geometry.firstBodyCell.querySelector<HTMLInputElement>("input")!;
    act(() => activeInput.focus());
    expect(document.activeElement).toBe(activeInput);
    act(() => geometry.firstRecordIndexCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const rowHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__row-handle");
    if (!rowHandle) throw new Error("CSV row handle did not mount.");
    makePointerCaptureSafe(rowHandle);

    await act(async () => {
      rowHandle.dispatchEvent(pointerEvent("pointerdown", 118, 145, 9));
      rowHandle.dispatchEvent(pointerEvent("pointermove", 118, 181, 9));
      expect(rowHandle.classList.contains("is-pressed")).toBe(true);
      expect(rowHandle.classList.contains("is-dragging")).toBe(true);
      rowHandle.dispatchEvent(pointerEvent("pointerup", 118, 181, 9));
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Name,Score\nLin,2\nAda,1");
    expect(rowHandle.classList.contains("is-pressed")).toBe(false);
    expect(rowHandle.classList.contains("is-dragging")).toBe(false);
    expect(document.activeElement).not.toBeInstanceOf(HTMLInputElement);
    expect(container?.querySelector("input:focus")).toBeNull();
    let outline = container?.querySelector<HTMLElement>(".po-editable-table-selection-outline");
    let selectedTarget = container?.querySelector<HTMLElement>(".po-editable-table-selection-target");
    expect(outline?.hidden).toBe(false);
    expect(outline?.dataset.axis).toBe("row");
    expect(selectedTarget?.dataset.csvRow).toBe("2");
    expect(selectedTarget?.querySelector<HTMLInputElement>('input[data-csv-column="0"]')?.value)
      .toBe("Ada");

    geometry = mockTableGeometry();
    const focusSentinel = document.createElement("button");
    document.body.appendChild(focusSentinel);
    focusSentinel.focus();
    act(() => geometry.firstBodyCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const columnHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__column-handle");
    if (!columnHandle) throw new Error("CSV column handle did not mount.");
    makePointerCaptureSafe(columnHandle);

    await act(async () => {
      columnHandle.dispatchEvent(pointerEvent("pointerdown", 184, 92, 11));
      columnHandle.dispatchEvent(pointerEvent("pointermove", 320, 92, 11));
      columnHandle.dispatchEvent(pointerEvent("pointerup", 320, 92, 11));
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Score,Name\n2,Lin\n1,Ada");
    expect(columnHandle.classList.contains("is-pressed")).toBe(false);
    expect(columnHandle.classList.contains("is-dragging")).toBe(false);
    expect(document.activeElement).toBe(focusSentinel);
    expect(container?.querySelector("input:focus")).toBeNull();
    outline = container?.querySelector<HTMLElement>(".po-editable-table-selection-outline");
    selectedTarget = container?.querySelector<HTMLElement>(".po-editable-table-selection-target");
    expect(outline?.hidden).toBe(false);
    expect(outline?.dataset.axis).toBe("column");
    expect(selectedTarget?.dataset.csvColumn).toBe("1");
    expect(selectedTarget?.querySelector<HTMLInputElement>("input")?.value).toBe("Name");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(outline?.hidden).toBe(true);
  });
});
