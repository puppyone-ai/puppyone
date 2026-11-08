/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { withTestLocalization } from "../../../../support/react/localization";
import { DesktopTooltipLayer } from "../../../../../src/components/DesktopTooltipLayer";
import { Harness, changeCount, container, latestSnapshot, makePointerCaptureSafe, mockRect, mockTableGeometry, pointerEvent, rect, remount, root, setLatestSnapshot, setUpCsvTable } from "../../../../support/editor/csvTableHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpCsvTable();

describe("CSV table: the frame, rows and columns", () => {
  it("keeps handle hints absent and menu hints hover-only while preserving initial focus and keyboard navigation", async () => {
    await act(async () => root?.render(withTestLocalization(<><Harness /><DesktopTooltipLayer /></>)));
    const geometry = mockTableGeometry();
    for (const handle of container!.querySelectorAll(".csv-table-editor__column-handle, .csv-table-editor__row-handle, .csv-table-editor__resize-handle")) {
      expect(handle.hasAttribute("data-tooltip")).toBe(false);
      expect(handle.getAttribute("aria-label")).toBeTruthy();
    }
    vi.useFakeTimers();
    act(() => geometry.firstBodyCell.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 120, clientY: 142,
    })));
    const menu = document.querySelector<HTMLElement>(".csv-table-editor__context-menu")!;
    const firstItem = menu.querySelector<HTMLButtonElement>("button:not(:disabled)")!;
    expect(document.activeElement).toBe(firstItem);
    act(() => vi.advanceTimersByTime(900));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => firstItem.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
    act(() => vi.advanceTimersByTime(450));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(firstItem.getAttribute("aria-label"));
    act(() => firstItem.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(firstItem);
    act(() => firstItem.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })));
    expect(document.activeElement).not.toBe(firstItem);
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(document.querySelector(".csv-table-editor__context-menu")).toBeNull();
    expect(changeCount).toBe(0);
  });

  it.each([
    ["rows", 0, 93, 5, 2],
    ["columns", 288, 0, 2, 5],
    ["both axes", 288, 93, 5, 5],
  ] as const)("renders corner expansion of %s immediately in StrictMode", async (_axis, dx, dy, rows, columns) => {
    await act(async () => {
      remount(withTestLocalization(<React.StrictMode><Harness /></React.StrictMode>));
    });
    mockTableGeometry();
    const handle = container!.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle")!;
    makePointerCaptureSafe(handle);
    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 81)));
    act(() => handle.dispatchEvent(pointerEvent("pointermove", 300 + dx, 200 + dy, 81)));
    expect(container!.querySelector("[data-resize-preview]")).not.toBeNull();
    act(() => handle.dispatchEvent(pointerEvent("pointerup", 300 + dx, 200 + dy, 81)));

    expect(changeCount).toBe(1);
    expect(latestSnapshot.split("\n")).toHaveLength(rows + 1);
    expect(latestSnapshot.split("\n")[0].split(",")).toHaveLength(columns);
    expect(container!.querySelectorAll("thead th[data-csv-column]")).toHaveLength(columns);
    expect(container!.querySelectorAll("tbody tr[data-csv-row]")).toHaveLength(rows);
    expect(container!.querySelectorAll("tbody tr:first-child td[data-csv-column]")).toHaveLength(columns);
    expect(container!.querySelector(".csv-table-editor__expansion-cell")).toBeNull();

    const historyKey = (shiftKey: boolean) => {
      const input = container!.querySelector<HTMLInputElement>('input[data-csv-row="1"][data-csv-column="0"]')!;
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true, cancelable: true, key: "z", metaKey: true, shiftKey,
      })));
    };
    historyKey(false);
    expect(container!.querySelectorAll("thead th[data-csv-column]")).toHaveLength(2);
    expect(container!.querySelectorAll("tbody tr[data-csv-row]")).toHaveLength(2);
    historyKey(true);
    expect(container!.querySelectorAll("thead th[data-csv-column]")).toHaveLength(columns);
    expect(container!.querySelectorAll("tbody tr[data-csv-row]")).toHaveLength(rows);

    act(() => handle.dispatchEvent(pointerEvent("pointerdown", 300, 200, 82)));
    act(() => handle.dispatchEvent(pointerEvent("pointermove", 396, 231, 82)));
    act(() => handle.dispatchEvent(pointerEvent("pointerup", 396, 231, 82)));
    expect(changeCount).toBe(4);
    expect(container!.querySelectorAll("thead th[data-csv-column]")).toHaveLength(columns + 1);
    expect(container!.querySelectorAll("tbody tr[data-csv-row]")).toHaveLength(rows + 1);
  });

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
    expect(container?.querySelector("[data-csv-display-row='1']")?.hasAttribute("data-tooltip"))
      .toBe(false);

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
      remount(withTestLocalization(<Harness />));
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
      remount(withTestLocalization(<Harness />));
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
    setLatestSnapshot("Name,City\nAda,London");
    await act(async () => {
      remount(withTestLocalization(<Harness documentId="ambiguous.csv" />));
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
    setLatestSnapshot("Column 1,Column 2,Column 3\n,,\n,,\n");
    await act(async () => {
      remount(withTestLocalization(<Harness documentId="new-grid.csv" />));
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
});
