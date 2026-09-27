"use client";

import type { MessageFormatter } from "@puppyone/localization/core";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import { EDITABLE_TABLE_COLUMN_MIN_WIDTH } from "../../table/editableTableLayout";
import { CSV_COLUMN_MAX_WIDTH } from "./CsvColumnLayoutModel";

type CsvColumnResizeLayerProps = Readonly<{
  columnWidths: readonly number[];
  direction: "ltr" | "rtl";
  onAutoFitColumn: (columnIndex: number) => void;
  onColumnWidthChange: (columnIndex: number, width: number) => void;
  onColumnWidthsCommit: () => void;
  surfaceRef: RefObject<HTMLDivElement>;
  tableRef: RefObject<HTMLTableElement>;
  t: MessageFormatter;
}>;

/** One progressively disclosed resize rail, shared by every mounted column. */
export function CsvColumnResizeLayer({
  columnWidths,
  direction,
  onAutoFitColumn,
  onColumnWidthChange,
  onColumnWidthsCommit,
  surfaceRef,
  tableRef,
  t,
}: CsvColumnResizeLayerProps) {
  const handleRef = useRef<HTMLButtonElement>(null);
  const activeColumnRef = useRef<number | null>(null);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const resizingRef = useRef(false);
  const widthsRef = useRef(columnWidths);
  const onAutoFitColumnRef = useRef(onAutoFitColumn);
  const onColumnWidthChangeRef = useRef(onColumnWidthChange);
  const onColumnWidthsCommitRef = useRef(onColumnWidthsCommit);
  widthsRef.current = columnWidths;
  onAutoFitColumnRef.current = onAutoFitColumn;
  onColumnWidthChangeRef.current = onColumnWidthChange;
  onColumnWidthsCommitRef.current = onColumnWidthsCommit;

  useEffect(() => {
    const table = tableRef.current;
    const surface = surfaceRef.current;
    const handle = handleRef.current;
    if (!table || !surface || !handle) return;

    let disposed = false;
    let positionFrame: number | null = null;
    const positionHandle = () => {
      if (disposed || resizingRef.current) return;
      const columnIndex = activeColumnRef.current;
      if (columnIndex == null) {
        handle.classList.remove("is-visible");
        return;
      }
      const cell = table.querySelector<HTMLTableCellElement>(
        `thead [data-csv-column="${columnIndex}"], tbody [data-csv-column="${columnIndex}"]`,
      );
      if (!cell) {
        handle.classList.remove("is-visible");
        return;
      }
      const surfaceRect = surface.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const boundary = direction === "rtl" ? cellRect.left : cellRect.right;
      handle.style.left = `${boundary - surfaceRect.left}px`;
      handle.style.top = `${tableRect.top - surfaceRect.top}px`;
      handle.style.height = `${tableRect.height}px`;
      handle.setAttribute("aria-label", t("editor.csv.resizeColumn", {
        column: columnIndex + 1,
      }));
      handle.classList.add("is-visible");
    };
    const schedulePosition = () => {
      if (positionFrame !== null) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        positionHandle();
      });
    };
    const updateHover = (event: PointerEvent) => {
      if (resizingRef.current || !(event.target instanceof Element)) return;
      const cell = event.target.closest<HTMLTableCellElement>("[data-csv-column]");
      if (!cell || !table.contains(cell)) return;
      const columnIndex = Number(cell.dataset.csvColumn);
      if (!Number.isInteger(columnIndex) || columnIndex === activeColumnRef.current) return;
      activeColumnRef.current = columnIndex;
      positionHandle();
    };
    const clearHover = (event: PointerEvent) => {
      if (resizingRef.current) return;
      if (event.relatedTarget instanceof Node && handle.contains(event.relatedTarget)) return;
      activeColumnRef.current = null;
      handle.classList.remove("is-visible");
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePosition);
    table.addEventListener("pointerover", updateHover);
    surface.addEventListener("pointerleave", clearHover);
    surface.closest(".csv-table-editor__scroll")?.addEventListener("scroll", positionHandle, {
      passive: true,
    });
    resizeObserver?.observe(table);
    return () => {
      disposed = true;
      activeResizeCleanupRef.current?.();
      table.removeEventListener("pointerover", updateHover);
      surface.removeEventListener("pointerleave", clearHover);
      surface.closest(".csv-table-editor__scroll")?.removeEventListener("scroll", positionHandle);
      resizeObserver?.disconnect();
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    };
  }, [direction, surfaceRef, t, tableRef]);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const columnIndex = activeColumnRef.current;
    const startWidth = columnIndex == null ? undefined : widthsRef.current[columnIndex];
    if (event.button !== 0 || columnIndex == null || startWidth == null) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    const surface = surfaceRef.current;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startLeft = Number.parseFloat(handle.style.left) || 0;
    const columnTrack = tableRef.current?.querySelector<HTMLTableColElement>(
      `col[data-csv-column="${columnIndex}"]`,
    ) ?? null;
    let currentWidth = startWidth;
    activeResizeCleanupRef.current?.();
    resizingRef.current = true;
    handle.classList.add("is-resizing");
    surface?.classList.add("is-column-resizing");
    handle.setPointerCapture?.(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const delta = (moveEvent.clientX - startX) * (direction === "rtl" ? -1 : 1);
      currentWidth = Math.max(
        EDITABLE_TABLE_COLUMN_MIN_WIDTH,
        Math.min(CSV_COLUMN_MAX_WIDTH, Math.round(startWidth + delta)),
      );
      const physicalDelta = (currentWidth - startWidth) * (direction === "rtl" ? -1 : 1);
      handle.style.left = `${startLeft + physicalDelta}px`;
      // Keep the high-frequency gesture out of React's mounted input tree.
      // The semantic View State is committed once, at the pointer boundary.
      if (columnTrack) columnTrack.style.width = `${currentWidth}px`;
    };
    const cleanup = () => {
      if (activeResizeCleanupRef.current !== cleanup) return;
      activeResizeCleanupRef.current = null;
      resizingRef.current = false;
      handle.classList.remove("is-resizing");
      surface?.classList.remove("is-column-resizing");
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      handle.removeEventListener("lostpointercapture", onLostPointerCapture);
      handle.ownerDocument.removeEventListener("keydown", onKeyDown, true);
      handle.ownerDocument.defaultView?.removeEventListener("blur", onWindowBlur);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      cleanup();
      onColumnWidthChangeRef.current(columnIndex, currentWidth);
      onColumnWidthsCommitRef.current();
    };
    const onPointerCancel = (cancelEvent: PointerEvent) => {
      cancelEvent.preventDefault();
      cancelEvent.stopPropagation();
      if (columnTrack) columnTrack.style.width = `${startWidth}px`;
      handle.style.left = `${startLeft}px`;
      cleanup();
    };
    const onLostPointerCapture = () => {
      if (columnTrack) columnTrack.style.width = `${startWidth}px`;
      handle.style.left = `${startLeft}px`;
      cleanup();
    };
    const onWindowBlur = () => onLostPointerCapture();
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (columnTrack) columnTrack.style.width = `${startWidth}px`;
      handle.style.left = `${startLeft}px`;
      cleanup();
    };
    activeResizeCleanupRef.current = cleanup;
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    handle.addEventListener("lostpointercapture", onLostPointerCapture);
    handle.ownerDocument.addEventListener("keydown", onKeyDown, true);
    handle.ownerDocument.defaultView?.addEventListener("blur", onWindowBlur);
  };

  return (
    <div className="csv-table-editor__column-resize-layer">
      <button
        ref={handleRef}
        type="button"
        className="csv-table-editor__column-resize-handle"
        tabIndex={-1}
        aria-label={t("editor.csv.resizeColumnHint")}
        data-tooltip={t("editor.csv.resizeColumnHint")}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const columnIndex = activeColumnRef.current;
          if (columnIndex != null) onAutoFitColumnRef.current(columnIndex);
        }}
        onPointerDown={startResize}
      />
    </div>
  );
}
