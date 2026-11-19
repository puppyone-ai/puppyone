/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { CsvTableResizeControl } from "../../../../../src/shared-ui/editor/viewers/csv/CsvTableResizeControl";
import { testT, withTestLocalization } from "../../../../support/react/localization";
import { DesktopTooltipLayer } from "../../../../../src/components/DesktopTooltipLayer";
import { Harness, changeCount, container, latestSnapshot, makePointerCaptureSafe, mockTableGeometry, pointerEvent, remount, root, setInputValue, setLatestSnapshot, setUpCsvTable } from "../../../../support/editor/csvTableHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpCsvTable();

describe("CSV table: expanding from the corner", () => {
  it("does not automatically hint the focused expansion-picker cell", async () => {
    await act(async () => root?.render(withTestLocalization(<><Harness /><DesktopTooltipLayer /></>)));
    act(() => container!.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle")!.click());
    const picker = container!.querySelector<HTMLElement>(".csv-table-editor__resize-picker")!;
    const cell = picker.querySelector<HTMLButtonElement>("button[tabindex='0']")!;
    expect(document.activeElement).toBe(cell);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    vi.useFakeTimers();
    act(() => cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
    act(() => vi.advanceTimersByTime(450));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBeTruthy();
    act(() => cell.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
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
    setLatestSnapshot(`Name,Description\nAda,${"x".repeat(60)}`);
    await act(async () => {
      remount(withTestLocalization(<Harness documentId="wide-table.csv" />));
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
      remount(
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
      remount(
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
});
