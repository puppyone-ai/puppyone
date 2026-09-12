/**
 * @vitest-environment happy-dom
 */
import React, { useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CsvTableEditor } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { CsvTableResizeControl } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableResizeControl";
import type { EditorSourceSnapshotPort } from "../../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { testT, withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latestSnapshot = "";
let changeCount = 0;

beforeEach(async () => {
  window.localStorage.clear();
  latestSnapshot = "Name,Score\nAda,1\nLin,2";
  changeCount = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(<Harness />));
    await Promise.resolve();
  });
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
  await act(async () => Promise.resolve());
});

describe("CSV table interactions", () => {
  it("keeps data-row numbers inside the frame while settings control header semantics", async () => {
    expect(container?.querySelector(".csv-table-editor__toolbar")).toBeNull();
    expect(container?.querySelector(".csv-table-editor__settings-button")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(container?.querySelector(".csv-table-editor__settings-menu")).toBeNull();
    expect(container?.querySelector(".csv-table-editor__settings-popover")).toBeNull();
    expect(container?.querySelectorAll(".csv-table-editor__header-cell")).toHaveLength(2);
    expect(container?.querySelector(".csv-table-editor__record-index--header")?.textContent).toBe("");
    expect(Array.from(container?.querySelectorAll(".csv-table-editor__record-index-label") ?? [])
      .map((label) => label.textContent?.trim())).toEqual(["1", "2"]);
    expect(container?.querySelectorAll(".csv-table-editor__record-index input")).toHaveLength(0);
    expect(container?.querySelector("[data-csv-display-row='1']")?.getAttribute("title"))
      .toBe("Data row 1; CSV record 2");

    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    const headerToggle = document.querySelector<HTMLInputElement>(
      ".csv-table-editor__header-toggle-input",
    );
    expect(headerToggle?.getAttribute("role")).toBe("switch");
    expect(headerToggle?.checked).toBe(true);
    expect(headerToggle?.closest("label")?.querySelector(".csv-table-editor__view-toggle-label")?.textContent)
      .toBe("Header row");
    expect(document.querySelector(".csv-table-editor__row-numbers-toggle-input"))
      .toBeInstanceOf(HTMLInputElement);
    expect(document.querySelector(".csv-table-editor__settings-summary")).toBeNull();
    act(() => headerToggle?.click());
    expect(container?.querySelector(".csv-table-editor__table thead")).toBeNull();
    expect(headerToggle?.checked).toBe(false);
    expect(Array.from(container?.querySelectorAll(".csv-table-editor__record-index-label") ?? [])
      .map((label) => label.textContent?.trim())).toEqual(["1", "2", "3"]);
    expect(latestSnapshot).toBe("Name,Score\nAda,1\nLin,2");

    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness />));
      await Promise.resolve();
    });
    expect(container?.querySelector(".csv-table-editor__table thead")).toBeNull();
    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    expect(document.querySelector<HTMLInputElement>(".csv-table-editor__header-toggle-input")?.checked)
      .toBe(false);
  });

  it("toggles and persists the view-only row-number gutter without changing CSV content", async () => {
    const originalSnapshot = latestSnapshot;
    const originalChangeCount = changeCount;
    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    const rowNumbersToggle = document.querySelector<HTMLInputElement>(
      ".csv-table-editor__row-numbers-toggle-input",
    );
    expect(rowNumbersToggle?.getAttribute("role")).toBe("switch");
    expect(rowNumbersToggle?.checked).toBe(true);
    expect(rowNumbersToggle?.closest("label")?.querySelector(".csv-table-editor__view-toggle-label")?.textContent)
      .toBe("Row numbers");

    act(() => rowNumbersToggle?.click());
    expect(container?.querySelector(".csv-table-editor__record-index-column")).toBeNull();
    expect(container?.querySelector(".csv-table-editor__record-index")).toBeNull();
    expect(container?.querySelectorAll(".csv-table-editor__table colgroup col")).toHaveLength(2);
    expect(container?.querySelectorAll(".csv-table-editor__table thead tr > *")).toHaveLength(2);
    expect(container?.querySelectorAll(".csv-table-editor__table tbody tr:first-child > *")).toHaveLength(2);
    expect(container?.querySelector(".csv-table-editor__table")?.getAttribute("aria-colcount")).toBe("2");
    expect(container?.querySelector("thead th[data-csv-column='0']")?.getAttribute("aria-colindex"))
      .toBe("1");
    expect(container?.querySelector("tbody td[data-csv-column='0']")?.getAttribute("aria-colindex"))
      .toBe("1");
    expect(latestSnapshot).toBe(originalSnapshot);
    expect(changeCount).toBe(originalChangeCount);

    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness />));
      await Promise.resolve();
    });
    expect(container?.querySelector(".csv-table-editor__record-index")).toBeNull();
    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    expect(document.querySelector<HTMLInputElement>(".csv-table-editor__row-numbers-toggle-input")?.checked)
      .toBe(false);
  });

  it("keeps the row handle reachable from the table edge when row numbers are hidden", () => {
    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    act(() => document.querySelector<HTMLInputElement>(
      ".csv-table-editor__row-numbers-toggle-input",
    )?.click());

    const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
    const surface = container?.querySelector<HTMLElement>(".csv-table-editor__surface");
    const firstRow = container?.querySelector<HTMLTableRowElement>("tbody tr[data-csv-row='1']");
    const firstCell = firstRow?.querySelector<HTMLTableCellElement>("td[data-csv-column='0']");
    const rowHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__row-handle");
    if (!scrollContainer || !surface || !firstRow || !firstCell || !rowHandle) {
      throw new Error("CSV row handle fallback geometry did not mount.");
    }

    mockRect(scrollContainer, rect(80, 70, 800, 600));
    mockRect(surface, rect(100, 100, 192, 93));
    mockRect(firstRow, rect(100, 131, 192, 31));
    mockRect(firstCell, rect(100, 131, 96, 31));
    act(() => firstCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));

    expect(rowHandle.classList.contains("is-visible")).toBe(true);
    expect(rowHandle.classList.contains("is-inline-docked")).toBe(false);
    expect(rowHandle.style.left).toBe("0px");

    mockRect(surface, rect(40, 100, 192, 93));
    mockRect(firstRow, rect(40, 131, 192, 31));
    mockRect(firstCell, rect(40, 131, 96, 31));
    act(() => scrollContainer.dispatchEvent(new Event("scroll")));

    expect(rowHandle.classList.contains("is-inline-docked")).toBe(true);
    expect(rowHandle.style.left).toBe("40px");

    // A keyboard-triggered settings change does not produce pointerleave.
    // The active handle must be recomputed against the restored gutter rather
    // than keeping stale visibility/docking state from the old table shape.
    act(() => document.querySelector<HTMLInputElement>(
      ".csv-table-editor__row-numbers-toggle-input",
    )?.click());
    expect(container?.querySelector(".csv-table-editor__record-index")).toBeInstanceOf(
      HTMLTableCellElement,
    );
    expect(rowHandle.classList.contains("is-visible")).toBe(true);
    expect(rowHandle.classList.contains("is-inline-docked")).toBe(true);
  });

  it("defaults ambiguous all-text CSV content to data rows instead of silently promoting a header", async () => {
    latestSnapshot = "Name,City\nAda,London";
    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness documentId="ambiguous.csv" />));
      await Promise.resolve();
    });

    expect(container?.querySelector(".csv-table-editor__table thead")).toBeNull();
    expect(Array.from(container?.querySelectorAll(".csv-table-editor__record-index-label") ?? [])
      .map((label) => label.textContent?.trim())).toEqual(["1", "2"]);
    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__settings-button")?.click());
    expect(document.querySelector<HTMLInputElement>(".csv-table-editor__header-toggle-input")?.checked)
      .toBe(false);
  });

  it("renders a new three-by-three CSV template with a header and two editable rows", async () => {
    latestSnapshot = "Column 1,Column 2,Column 3\n,,\n,,\n";
    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness documentId="new-grid.csv" />));
      await Promise.resolve();
    });

    expect(container?.querySelectorAll(".csv-table-editor__header-cell")).toHaveLength(3);
    expect(container?.querySelectorAll(".csv-table-editor__table tbody tr")).toHaveLength(2);
    expect(container?.querySelectorAll(
      ".csv-table-editor__table tbody tr:first-child td[data-csv-column]",
    )).toHaveLength(3);
    expect(container?.querySelector(".csv-table-editor__table")?.getAttribute("aria-rowcount"))
      .toBe("3");
    expect(latestSnapshot).toBe("Column 1,Column 2,Column 3\n,,\n,,\n");
    expect(changeCount).toBe(0);
  });

  it("marks horizontal scrolling so the frozen record gutter can own the viewport edge", () => {
    const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
    if (!scrollContainer) throw new Error("CSV scroll container did not mount.");

    act(() => {
      scrollContainer.scrollLeft = 1;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(scrollContainer.hasAttribute("data-inline-scrolled")).toBe(true);

    act(() => {
      scrollContainer.scrollLeft = 0;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(scrollContainer.hasAttribute("data-inline-scrolled")).toBe(false);
  });

  it("expands to a selected row and column shape from the corner picker in one snapshot", async () => {
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");

    act(() => resizeHandle.click());
    const target = document.querySelector<HTMLButtonElement>(
      ".csv-table-editor__resize-picker-cell[data-added-rows='2'][data-added-columns='3']",
    );
    expect(target?.getAttribute("aria-label")).toBe("Expand to 4 rows × 5 columns");

    const changesBeforeExpansion = changeCount;
    await act(async () => {
      target?.click();
      await Promise.resolve();
    });
    expect(changeCount).toBe(changesBeforeExpansion + 1);
    expect(latestSnapshot).toBe("Name,Score,,,\nAda,1,,,\nLin,2,,,\n,,,,\n,,,,");

    const firstBodyInput = container?.querySelector<HTMLInputElement>(
      "input[data-csv-row='1'][data-csv-column='0']",
    );
    if (!firstBodyInput) throw new Error("CSV first body input did not mount.");
    act(() => {
      setInputValue(firstBodyInput, "Ada Lovelace");
      firstBodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latestSnapshot).toBe("Name,Score,,,\nAda Lovelace,1,,,\nLin,2,,,\n,,,,\n,,,,");
    expect(container?.querySelectorAll(".csv-table-editor__table tbody tr")).toHaveLength(4);
    expect(container?.querySelectorAll(
      ".csv-table-editor__table tbody tr:first-child td[data-csv-column]",
    )).toHaveLength(5);
    expect(document.querySelector(".csv-table-editor__resize-picker")).toBeNull();
  });

  it("keeps small pointer jitter as a click instead of starting expansion", async () => {
    mockTableGeometry();
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 8));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 305, 205, 8));
      resizeHandle.dispatchEvent(pointerEvent("pointerup", 305, 205, 8));
      await Promise.resolve();
    });

    expect(document.querySelector(".csv-table-editor__resize-status")).toBeNull();
    expect(container?.querySelector(".csv-table-editor__expansion-cell")).toBeNull();
    act(() => resizeHandle.click());
    expect(document.querySelector(".csv-table-editor__resize-picker")).not.toBeNull();
  });

  it("previews outward corner dragging and treats inward dragging as a non-destructive cancel", async () => {
    mockTableGeometry();
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 9));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 541, 278, 9));
      await Promise.resolve();
    });
    expect(document.querySelector(".csv-table-editor__resize-status")?.textContent)
      .toContain("5 rows × 5 columns");
    expect(container?.querySelector(".csv-table-editor__surface")
      ?.getAttribute("data-resize-preview")).toBe("true");
    expect(container?.querySelectorAll(".csv-table-editor__table colgroup col"))
      .toHaveLength(6);
    expect(container?.querySelectorAll(".csv-table-editor__table thead .csv-table-editor__expansion-cell--column"))
      .toHaveLength(3);
    expect(container?.querySelectorAll(".csv-table-editor__table tbody > tr[data-csv-row]"))
      .toHaveLength(2);
    const previewRows = container?.querySelectorAll<HTMLTableRowElement>(
      ".csv-table-editor__table tbody > .csv-table-editor__expansion-row",
    );
    expect(previewRows).toHaveLength(3);
    expect(Array.from(
      previewRows ?? [],
      (row) => row.querySelector(".csv-table-editor__record-index-label")?.textContent,
    )).toEqual(["3", "4", "5"]);
    expect(previewRows?.[0]?.querySelectorAll("td")).toHaveLength(5);
    expect(container?.querySelectorAll(
      ".csv-table-editor__table tbody > tr[data-csv-row] .csv-table-editor__expansion-cell--column",
    )).toHaveLength(6);
    expect(document.querySelector(".csv-table-editor__resize-preview")).toBeNull();

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerup", 541, 278, 9));
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Name,Score,,,\nAda,1,,,\nLin,2,,,\n,,,,\n,,,,\n,,,,");
    expect(container?.querySelector(".csv-table-editor__surface")
      ?.hasAttribute("data-resize-preview")).toBe(false);
    expect(container?.querySelector(".csv-table-editor__expansion-cell")).toBeNull();

    const expandedSnapshot = latestSnapshot;
    makePointerCaptureSafe(resizeHandle);
    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 10));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 240, 150, 10));
      resizeHandle.dispatchEvent(pointerEvent("pointerup", 240, 150, 10));
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe(expandedSnapshot);
  });

  it("clears an expansion preview when pointer capture is lost or the window blurs", async () => {
    mockTableGeometry();
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);
    const originalSnapshot = latestSnapshot;

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 18));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 541, 278, 18));
      await Promise.resolve();
    });
    expect(container?.querySelector(".csv-table-editor__surface")
      ?.getAttribute("data-resize-preview")).toBe("true");

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("lostpointercapture", 541, 278, 18));
      await Promise.resolve();
    });
    expect(container?.querySelector(".csv-table-editor__surface")
      ?.hasAttribute("data-resize-preview")).toBe(false);
    expect(container?.querySelector(".csv-table-editor__expansion-cell")).toBeNull();
    expect(latestSnapshot).toBe(originalSnapshot);

    makePointerCaptureSafe(resizeHandle);
    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 19));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 541, 278, 19));
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });
    expect(container?.querySelector(".csv-table-editor__surface")
      ?.hasAttribute("data-resize-preview")).toBe(false);
    expect(container?.querySelector(".csv-table-editor__resize-status")).toBeNull();
    expect(latestSnapshot).toBe(originalSnapshot);
  });

  it("aligns a downward preview to the record gutter and content-sized columns", async () => {
    latestSnapshot = `Name,Description\nAda,${"x".repeat(60)}`;
    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness documentId="wide-table.csv" />));
      await Promise.resolve();
    });
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 21));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 300, 231, 21));
      await Promise.resolve();
    });

    const previewRow = container?.querySelector<HTMLTableRowElement>(
      ".csv-table-editor__table tbody > .csv-table-editor__expansion-row",
    );
    expect(Array.from(
      container?.querySelectorAll<HTMLTableColElement>(
        ".csv-table-editor__table colgroup col:not(.csv-table-editor__record-index-column)",
      ) ?? [],
      (column) => column.style.width,
    )).toEqual(["96px", "220px"]);
    expect(previewRow?.querySelector(".csv-table-editor__record-index-label")?.textContent)
      .toBe("3");
    expect(previewRow?.querySelectorAll("td")).toHaveLength(2);
    expect(document.querySelector(".csv-table-editor__expansion-cell--column")).toBeNull();

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointercancel", 300, 231, 21));
      await Promise.resolve();
    });
  });

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
      root?.unmount();
      root = createRoot(container!);
      root.render(withTestLocalization(<Harness />));
      await Promise.resolve();
    });
    expect(container?.querySelector<HTMLTableColElement>(
      ".csv-table-editor__table colgroup col:not(.csv-table-editor__record-index-column)",
    )?.style.width).toBe("176px");
  });

  it("uses the full editor height and clamps a pointer dragged beyond it", async () => {
    mockTableGeometry();
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 25));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 300, 2000, 25));
      await Promise.resolve();
    });

    expect(document.querySelector(".csv-table-editor__resize-status")?.textContent)
      .toContain("17 rows × 2 columns");
    expect(container?.querySelectorAll(".csv-table-editor__expansion-row"))
      .toHaveLength(15);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointercancel", 300, 2000, 25));
      await Promise.resolve();
    });
  });

  it("keeps picker row semantics when fewer than six columns remain available", async () => {
    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(
        <CsvTableResizeControl
          currentColumnCount={254}
          currentDataRowCount={2}
          direction="ltr"
          onExpand={vi.fn()}
          onPreviewChange={vi.fn()}
          t={testT}
        />,
      );
      await Promise.resolve();
    });

    act(() => container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle")?.click());
    const pickerGrid = document.querySelector<HTMLElement>(".csv-table-editor__resize-picker-grid");
    expect(pickerGrid?.getAttribute("aria-colcount")).toBe("2");
    expect(pickerGrid?.getAttribute("aria-rowcount")).toBe("6");
    const pickerRows = Array.from(pickerGrid?.querySelectorAll<HTMLElement>(":scope > [role='row']") ?? []);
    expect(pickerRows).toHaveLength(6);
    for (const pickerRow of pickerRows) {
      expect(pickerRow.style.gridTemplateColumns).toBe("repeat(2, 16px)");
      expect(pickerRow.querySelectorAll(":scope > [role='gridcell']")).toHaveLength(2);
    }
  });

  it("reports the same logical expansion for an outward RTL drag", async () => {
    const onPreviewChange = vi.fn();
    await act(async () => {
      root?.unmount();
      root = createRoot(container!);
      root.render(
        <CsvTableResizeControl
          currentColumnCount={2}
          currentDataRowCount={2}
          direction="rtl"
          onExpand={vi.fn()}
          onPreviewChange={onPreviewChange}
          t={testT}
        />,
      );
      await Promise.resolve();
    });
    const resizeHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle");
    if (!resizeHandle) throw new Error("CSV resize handle did not mount.");
    makePointerCaptureSafe(resizeHandle);

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 31));
      resizeHandle.dispatchEvent(pointerEvent("pointermove", 204, 231, 31));
      await Promise.resolve();
    });

    expect(container?.querySelector(".csv-table-editor__resize-control")?.getAttribute("dir")).toBe("rtl");
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      addedColumns: 1,
      addedRows: 1,
    });

    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointercancel", 204, 231, 31));
      await Promise.resolve();
    });
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
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
      rowHandle.dispatchEvent(pointerEvent("pointerup", 98, 145, 7));
      await Promise.resolve();
    });

    const menu = document.querySelector(".csv-table-editor__context-menu");
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    expect(rowHandle.getAttribute("aria-expanded")).toBe("true");

    const moveDown = findButton("Move row down");
    await act(async () => {
      moveDown?.click();
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Name,Score\nLin,2\nAda,1");
    expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
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
    expect(menu?.querySelectorAll(".desktop-menu-section")).toHaveLength(2);
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(12);
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
    expect(menu?.querySelectorAll(".desktop-menu-section")).toHaveLength(1);
    expect(menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    expect(menu?.querySelector(".desktop-menu-section-label")?.textContent).toBe("Columns");
    expect(findButton("Insert row below")).toBeNull();
  });

  it("drags rows and columns using midpoint drop boundaries", async () => {
    let geometry = mockTableGeometry();
    act(() => geometry.firstRecordIndexCell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const rowHandle = container?.querySelector<HTMLButtonElement>(".csv-table-editor__row-handle");
    if (!rowHandle) throw new Error("CSV row handle did not mount.");
    makePointerCaptureSafe(rowHandle);

    await act(async () => {
      rowHandle.dispatchEvent(pointerEvent("pointerdown", 118, 145, 9));
      rowHandle.dispatchEvent(pointerEvent("pointermove", 118, 181, 9));
      rowHandle.dispatchEvent(pointerEvent("pointerup", 118, 181, 9));
      await Promise.resolve();
    });
    expect(latestSnapshot).toBe("Name,Score\nLin,2\nAda,1");

    geometry = mockTableGeometry();
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
  });
});

function Harness({ documentId = "table.csv" }: { documentId?: string }) {
  const initialContentRef = useRef(latestSnapshot);
  const snapshotPortRef = useRef<EditorSourceSnapshotPort | null>(null);
  return (
    <CsvTableEditor
      content={initialContentRef.current}
      documentId={documentId}
      nodeName="table.csv"
      readOnly={false}
      onSnapshotPortChange={(port) => {
        snapshotPortRef.current = port;
      }}
      onSourceRevisionChange={(revision) => {
        if (revision.origin !== "local-edit") return;
        changeCount += 1;
        latestSnapshot = snapshotPortRef.current?.readSnapshot().content ?? latestSnapshot;
      }}
    />
  );
}

function mockTableGeometry() {
  const surface = container?.querySelector<HTMLElement>(".csv-table-editor__surface");
  const scrollContainer = container?.querySelector<HTMLElement>(".csv-table-editor__scroll");
  const table = container?.querySelector<HTMLTableElement>(".csv-table-editor__table");
  const headerRecordCell = container?.querySelector<HTMLTableCellElement>("thead [data-csv-record-index]");
  const headerCells = Array.from(container?.querySelectorAll<HTMLTableCellElement>("thead th[data-csv-column]") ?? []);
  const bodyRows = Array.from(container?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? []);
  if (!surface || !scrollContainer || !table || !headerRecordCell || headerCells.length !== 2 || bodyRows.length !== 2) {
    throw new Error("CSV table geometry could not be prepared.");
  }
  mockRect(scrollContainer, rect(80, 70, 800, 600));
  mockRect(surface, rect(100, 100, 223, 93));
  mockRect(table, rect(100, 100, 223, 93));
  mockRect(headerRecordCell, rect(100, 100, 31, 31));
  headerCells.forEach((cell, index) => mockRect(cell, rect(131 + index * 96, 100, 96, 31)));
  bodyRows.forEach((row, rowIndex) => {
    mockRect(row, rect(100, 131 + rowIndex * 31, 223, 31));
    const recordIndexCell = row.querySelector<HTMLTableCellElement>("[data-csv-record-index]");
    if (!recordIndexCell) throw new Error("CSV record index cell did not mount.");
    mockRect(recordIndexCell, rect(100, 131 + rowIndex * 31, 31, 31));
    Array.from(row.querySelectorAll<HTMLTableCellElement>("td[data-csv-column]")).forEach((cell, columnIndex) => {
      mockRect(cell, rect(131 + columnIndex * 96, 131 + rowIndex * 31, 96, 31));
    });
  });
  const firstBodyCell = bodyRows[0].querySelector<HTMLTableCellElement>("td[data-csv-column='0']");
  const firstRecordIndexCell = bodyRows[0].querySelector<HTMLTableCellElement>("[data-csv-record-index]");
  if (!firstBodyCell || !firstRecordIndexCell) throw new Error("CSV first data row did not mount.");
  return { firstBodyCell, firstHeaderCell: headerCells[0], firstRecordIndexCell };
}

function findButton(label: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => (
      button.querySelector(".desktop-menu-item-label")?.textContent?.trim()
      ?? button.textContent?.trim()
    ) === label) ?? null;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

function pointerEvent(type: string, clientX: number, clientY: number, pointerId: number) {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX, clientY, pointerId });
}

function makePointerCaptureSafe(handle: HTMLElement) {
  let capturedPointer: number | null = null;
  Object.defineProperties(handle, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointer === pointerId,
    },
    releasePointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        if (capturedPointer === pointerId) capturedPointer = null;
      },
    },
    setPointerCapture: {
      configurable: true,
      value: (pointerId: number) => {
        capturedPointer = pointerId;
      },
    },
  });
}

function mockRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}
