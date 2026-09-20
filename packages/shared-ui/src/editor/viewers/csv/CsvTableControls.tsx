"use client";

import { showEditableTableHandle } from "../../table/editableTableHandle";
import { createEditableTableSelection } from "../../table/editableTableSelection";
import type { MessageFormatter } from "@puppyone/localization/core";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  getEditableTableColumnDropBoundary,
  getEditableTableDropBoundary,
} from "../../table/editableTableDrag";
import { CsvTableMenu, type CsvTableMenuTarget } from "./CsvTableMenu";
import type { CsvTableStructureOperation } from "./csvTableOperations";

type CsvTableControlsProps = Readonly<{
  columnCount: number;
  direction: "ltr" | "rtl";
  headerEnabled: boolean;
  locale: string;
  onAutoFitColumn: (columnIndex: number) => void;
  onOperation: (operation: CsvTableStructureOperation) => void;
  rowCount: number;
  rowNumbersVisible: boolean;
  surfaceRef: RefObject<HTMLDivElement>;
  tableRef: RefObject<HTMLTableElement>;
  t: MessageFormatter;
}>;

type CsvTableDragKind = "column" | "row";

// Table grips straddle their outside edge by roughly nine pixels. Once the
// remaining scroll-padding gap is narrower than that, dock the grip inside its
// sticky header/gutter cell so the scroll viewport never clips the hit target.
const COLUMN_HANDLE_OUTER_REACH_PX = 9;
const ROW_HANDLE_OUTER_REACH_PX = 9;

export function CsvTableControls({
  columnCount,
  direction,
  headerEnabled,
  locale,
  onAutoFitColumn,
  onOperation,
  rowCount,
  rowNumbersVisible,
  surfaceRef,
  tableRef,
  t,
}: CsvTableControlsProps) {
  const columnHandleRef = useRef<HTMLButtonElement>(null);
  const rowHandleRef = useRef<HTMLButtonElement>(null);
  const dropIndicatorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<ReturnType<typeof createEditableTableSelection> | null>(null);
  const hoverRef = useRef({ columnIndex: null as number | null, rowIndex: null as number | null, dragging: false });
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const menuSequenceRef = useRef(0);
  const menuTargetRef = useRef<CsvTableMenuTarget | null>(null);
  const onOperationRef = useRef(onOperation);
  const positionHandlesRef = useRef<() => void>(() => undefined);
  const openMenuRef = useRef<(kind: CsvTableDragKind, sourceIndex: number, handle: HTMLButtonElement) => void>(
    () => undefined,
  );
  const startDragRef = useRef<(event: PointerEvent, kind: CsvTableDragKind) => void>(() => undefined);
  const [menuTarget, setMenuTarget] = useState<CsvTableMenuTarget | null>(null);
  onOperationRef.current = onOperation;

  const closeMenu = useCallback((restoreFocus: boolean) => {
    const current = menuTargetRef.current;
    if (!current) return;
    const table = tableRef.current;
    if (table && current.kind !== "cell") {
      setCsvTableSourceHighlight(
        table,
        current.kind,
        current.kind === "row" ? current.rowIndex : current.columnIndex,
        false,
        selectionRef.current,
      );
    }
    current.restoreFocus?.classList.remove("is-menu-active");
    current.restoreFocus?.setAttribute("aria-expanded", "false");
    current.restoreFocus?.removeAttribute("aria-controls");
    menuTargetRef.current = null;
    setMenuTarget(null);
    if (restoreFocus && current.restoreFocus?.isConnected) {
      current.restoreFocus.focus({ preventScroll: true });
    }
    queueMicrotask(() => positionHandlesRef.current());
  }, [tableRef]);

  useLayoutEffect(() => {
    positionHandlesRef.current();
  }, [columnCount, headerEnabled, rowCount]);

  useEffect(() => {
    const table = tableRef.current;
    const surface = surfaceRef.current;
    const columnHandle = columnHandleRef.current;
    const rowHandle = rowHandleRef.current;
    const dropIndicator = dropIndicatorRef.current;
    if (!table || !surface || !columnHandle || !rowHandle || !dropIndicator) return;

    const selection = createEditableTableSelection(surface, table);
    selectionRef.current = selection;
    let disposed = false;
    let positionFrame: number | null = null;
    let dockedHeaderCell: HTMLTableCellElement | null = null;
    let dockedRecordIndexCell: HTMLTableCellElement | null = null;
    const scrollContainer = surface.closest<HTMLElement>(".csv-table-editor__scroll");
    const firstMovableRow = headerEnabled ? 1 : 0;
    const getBodyRows = () => Array.from(
      table.querySelectorAll<HTMLTableRowElement>("tbody tr[data-csv-row]"),
    );
    const getColumnCells = () => {
      const referenceRow = table.querySelector<HTMLTableRowElement>("thead tr, tbody tr[data-csv-row]");
      return referenceRow
        ? Array.from(referenceRow.querySelectorAll<HTMLTableCellElement>(
            "th[data-csv-column], td[data-csv-column]",
          )).sort((left, right) => Number(left.dataset.csvColumn) - Number(right.dataset.csvColumn))
        : [];
    };
    const getColumnCell = (columnIndex: number) => getColumnCells()
      .find((cell) => Number(cell.dataset.csvColumn) === columnIndex) ?? null;
    const setHandleVisible = (handle: HTMLElement, visible: boolean) => {
      handle.classList.toggle("is-visible", visible);
    };
    const setColumnHandleDocked = (
      headerCell: HTMLTableCellElement | null,
      docked: boolean,
    ) => {
      if (dockedHeaderCell && (dockedHeaderCell !== headerCell || !docked)) {
        dockedHeaderCell.removeAttribute("data-column-handle-docked");
      }
      dockedHeaderCell = docked ? headerCell : null;
      dockedHeaderCell?.setAttribute("data-column-handle-docked", "");
      columnHandle.classList.toggle("is-block-docked", docked);
    };
    const setRowHandleDocked = (
      recordIndexCell: HTMLTableCellElement | null,
      docked: boolean,
    ) => {
      if (dockedRecordIndexCell && (dockedRecordIndexCell !== recordIndexCell || !docked)) {
        dockedRecordIndexCell.removeAttribute("data-row-handle-docked");
      }
      dockedRecordIndexCell = docked ? recordIndexCell : null;
      dockedRecordIndexCell?.setAttribute("data-row-handle-docked", "");
      rowHandle.classList.toggle("is-inline-docked", docked);
    };
    const positionHandles = (followPointer = false) => {
      if (disposed || !surface.isConnected) return;
      const columnIndex = hoverRef.current.columnIndex;
      const rowIndex = hoverRef.current.rowIndex;
      if (columnIndex == null && rowIndex == null) {
        setColumnHandleDocked(null, false);
        setRowHandleDocked(null, false);
        setHandleVisible(columnHandle, false);
        setHandleVisible(rowHandle, false);
        return;
      }
      const surfaceRect = surface.getBoundingClientRect();
      const scrollRect = scrollContainer?.getBoundingClientRect();
      const columnCell = columnIndex == null ? null : getColumnCell(columnIndex);
      if (columnCell && columnIndex != null) {
        const rect = columnCell.getBoundingClientRect();
        const headerCell = headerEnabled && columnCell.closest("thead")
          ? columnCell
          : null;
        const remainingOuterGap = scrollRect && headerCell
          ? rect.top - scrollRect.top
          : Number.POSITIVE_INFINITY;
        setColumnHandleDocked(
          headerCell,
          remainingOuterGap < COLUMN_HANDLE_OUTER_REACH_PX,
        );
        showEditableTableHandle(
          columnHandle,
          `${rect.left - surfaceRect.left + rect.width / 2}px`,
          `${rect.top - surfaceRect.top}px`,
          followPointer,
        );
        columnHandle.setAttribute("aria-label", t("editor.table.columnActions", {
          column: columnIndex + 1,
        }));
      } else {
        setColumnHandleDocked(null, false);
        setHandleVisible(columnHandle, false);
      }

      const row = rowIndex == null || rowIndex < firstMovableRow
        ? null
        : getBodyRows().find((candidate) => Number(candidate.dataset.csvRow) === rowIndex) ?? null;
      if (row && rowIndex != null) {
        const recordIndexCell = row.querySelector<HTMLTableCellElement>("[data-csv-record-index]");
        const fallbackCell = row.querySelector<HTMLTableCellElement>("td[data-csv-column='0']");
        const anchorCell = rowNumbersVisible ? recordIndexCell : fallbackCell;
        const rect = anchorCell?.getBoundingClientRect();
        if (!anchorCell || !rect) {
          setRowHandleDocked(null, false);
          setHandleVisible(rowHandle, false);
          return;
        }
        const remainingOuterGap = scrollRect
          ? direction === "rtl"
            ? scrollRect.right - rect.right
            : rect.left - scrollRect.left
          : Number.POSITIVE_INFINITY;
        setRowHandleDocked(
          recordIndexCell,
          remainingOuterGap < ROW_HANDLE_OUTER_REACH_PX,
        );
        rowHandle.style.removeProperty("right");
        // Anchor the row control to the outside edge of the record-index
        // gutter, or the first data cell when that gutter is hidden. The
        // shared handle transform keeps the hit target inside the viewport
        // whenever scrolling leaves no room outside the table frame.
        const rawRowBoundary = direction === "rtl" ? rect.right : rect.left;
        const rowBoundary = !recordIndexCell && scrollRect && remainingOuterGap < ROW_HANDLE_OUTER_REACH_PX
          ? direction === "rtl" ? scrollRect.right : scrollRect.left
          : rawRowBoundary;
        showEditableTableHandle(
          rowHandle,
          `${rowBoundary - surfaceRect.left}px`,
          `${rect.top - surfaceRect.top + rect.height / 2}px`,
          followPointer,
        );
        rowHandle.setAttribute("aria-label", t("editor.table.rowActions", {
          row: rowIndex - firstMovableRow + 1,
        }));
      } else {
        setRowHandleDocked(null, false);
        setHandleVisible(rowHandle, false);
      }
    };
    positionHandlesRef.current = positionHandles;
    const schedulePositionHandles = () => {
      if (disposed || positionFrame !== null) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        positionHandles();
      });
    };

    const openMenu = (kind: CsvTableDragKind, sourceIndex: number, handle: HTMLButtonElement) => {
      closeMenu(false);
      positionHandles();
      const crossRow = hoverRef.current.rowIndex ?? Math.min(firstMovableRow, rowCount - 1);
      const crossColumn = hoverRef.current.columnIndex ?? 0;
      setCsvTableSourceHighlight(table, kind, sourceIndex, true, selection);
      handle.classList.add("is-menu-active");
      const anchor = handle.querySelector<HTMLElement>(".po-editable-table-drag-handle-visual") ?? handle;
      const rect = anchor.getBoundingClientRect();
      const dockedColumnCellRect = kind === "column" && handle.classList.contains("is-block-docked")
        ? getColumnCell(sourceIndex)?.getBoundingClientRect()
        : null;
      const nextTarget: CsvTableMenuTarget = {
        clientX: kind === "row"
          ? direction === "rtl" ? rect.left - 4 : rect.right + 4
          : rect.left,
        clientY: kind === "row" ? rect.top : (dockedColumnCellRect?.bottom ?? rect.bottom) + 4,
        columnIndex: kind === "column" ? sourceIndex : crossColumn,
        kind,
        menuId: `csv-table-menu-${++menuSequenceRef.current}`,
        restoreFocus: handle,
        rowIndex: kind === "row" ? sourceIndex : Math.max(0, crossRow),
      };
      menuTargetRef.current = nextTarget;
      setMenuTarget(nextTarget);
      handle.setAttribute("aria-controls", nextTarget.menuId);
      handle.setAttribute("aria-expanded", "true");
    };
    openMenuRef.current = openMenu;

    const openCellMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const recordIndexCell = target.closest<HTMLTableCellElement>("[data-csv-record-index]");
      if (recordIndexCell && table.contains(recordIndexCell)) {
        const rowIndex = Number(recordIndexCell.dataset.csvRecordIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < firstMovableRow) return;
        event.preventDefault();
        event.stopPropagation();
        hoverRef.current.rowIndex = rowIndex;
        hoverRef.current.columnIndex = null;
        positionHandles();
        openMenu("row", rowIndex, rowHandle);
        return;
      }
      const cell = target.closest<HTMLTableCellElement>(
        "td[data-csv-row][data-csv-column], th[data-csv-row][data-csv-column]",
      );
      if (!cell || !table.contains(cell)) return;
      const rowIndex = Number(cell.dataset.csvRow);
      const columnIndex = Number(cell.dataset.csvColumn);
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(false);
      const restoreFocus = cell.querySelector<HTMLElement>("input") ?? cell;
      const keyboardInvocation = event.clientX === 0 && event.clientY === 0;
      const rect = keyboardInvocation ? cell.getBoundingClientRect() : null;
      const nextTarget: CsvTableMenuTarget = {
        clientX: rect ? rect.left : event.clientX,
        clientY: rect ? rect.bottom + 4 : event.clientY,
        columnIndex,
        kind: headerEnabled && rowIndex === 0 ? "column" : "cell",
        menuId: `csv-table-menu-${++menuSequenceRef.current}`,
        restoreFocus,
        rowIndex,
      };
      menuTargetRef.current = nextTarget;
      setMenuTarget(nextTarget);
      restoreFocus.setAttribute("aria-controls", nextTarget.menuId);
      restoreFocus.setAttribute("aria-expanded", "true");
    };

    const renderDropIndicator = (kind: CsvTableDragKind, sourceIndex: number, boundary: number | null) => {
      if (boundary == null) {
        dropIndicator.hidden = true;
        return;
      }
      const surfaceRect = surface.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();

      if (kind === "row") {
        const bodyRows = getBodyRows();
        const sourcePosition = bodyRows.findIndex((row) => Number(row.dataset.csvRow) === sourceIndex);
        const finalPosition = boundary > sourcePosition ? boundary - 1 : boundary;
        if (sourcePosition < 0 || finalPosition === sourcePosition || bodyRows.length === 0) {
          dropIndicator.hidden = true;
          return;
        }
        const nextRow = bodyRows[boundary];
        const previousRow = bodyRows[boundary - 1];
        const y = nextRow?.getBoundingClientRect().top ?? previousRow?.getBoundingClientRect().bottom;
        if (y == null) {
          dropIndicator.hidden = true;
          return;
        }
        dropIndicator.hidden = false;
        dropIndicator.className = "po-editable-table-drop-indicator csv-table-editor__drop-indicator is-row";
        dropIndicator.style.left = `${tableRect.left - surfaceRect.left}px`;
        dropIndicator.style.top = `${y - surfaceRect.top}px`;
        dropIndicator.style.width = `${tableRect.width}px`;
        dropIndicator.style.height = "";
        return;
      }

      const columnCells = getColumnCells();
      const sourcePosition = columnCells.findIndex(
        (cell) => Number(cell.dataset.csvColumn) === sourceIndex,
      );
      const finalPosition = boundary > sourcePosition ? boundary - 1 : boundary;
      if (sourcePosition < 0 || finalPosition === sourcePosition || columnCells.length === 0) {
        dropIndicator.hidden = true;
        return;
      }
      const x = direction === "rtl"
        ? boundary < columnCells.length
          ? columnCells[boundary].getBoundingClientRect().right
          : columnCells[columnCells.length - 1].getBoundingClientRect().left
        : boundary < columnCells.length
          ? columnCells[boundary].getBoundingClientRect().left
          : columnCells[columnCells.length - 1].getBoundingClientRect().right;
      dropIndicator.hidden = false;
      dropIndicator.className = "po-editable-table-drop-indicator csv-table-editor__drop-indicator is-column";
      dropIndicator.style.left = `${x - surfaceRect.left}px`;
      dropIndicator.style.top = `${tableRect.top - surfaceRect.top}px`;
      dropIndicator.style.width = "";
      dropIndicator.style.height = `${tableRect.height}px`;
    };

    const startDrag = (event: PointerEvent, kind: CsvTableDragKind) => {
      if (disposed || event.button !== 0) return;
      const sourceIndex = kind === "column" ? hoverRef.current.columnIndex : hoverRef.current.rowIndex;
      if (sourceIndex == null || (kind === "row" && sourceIndex < firstMovableRow)) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(false);
      activeDragCleanupRef.current?.();

      const handle = kind === "column" ? columnHandle : rowHandle;
      const otherHandle = kind === "column" ? rowHandle : columnHandle;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      let dropBoundary: number | null = null;
      hoverRef.current.dragging = true;
      positionHandles();
      handle.setPointerCapture?.(pointerId);
      setCsvTableSourceHighlight(table, kind, sourceIndex, true, selection);

      const beginVisualDrag = () => {
        handle.classList.add("is-dragging");
        setHandleVisible(otherHandle, false);
        surface.classList.add("is-table-dragging");
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        if (!moved) {
          if (Math.abs(moveEvent.clientX - startX) <= 4 && Math.abs(moveEvent.clientY - startY) <= 4) return;
          moved = true;
          beginVisualDrag();
        }
        dropBoundary = kind === "column"
          ? getEditableTableColumnDropBoundary(getColumnCells(), moveEvent.clientX, direction)
          : getEditableTableDropBoundary(getBodyRows().map((row, boundary) => {
              const rect = row.getBoundingClientRect();
              return { boundary, start: rect.top, size: rect.height };
            }), moveEvent.clientY);
        renderDropIndicator(kind, sourceIndex, dropBoundary);
      };
      const applyMove = () => {
        if (dropBoundary == null) return;
        if (kind === "column") {
          const columnCells = getColumnCells();
          const targetBoundary = dropBoundary < columnCells.length
            ? Number(columnCells[dropBoundary]?.dataset.csvColumn)
            : Number(columnCells[columnCells.length - 1]?.dataset.csvColumn) + 1;
          const targetColumnIndex = targetBoundary > sourceIndex ? targetBoundary - 1 : targetBoundary;
          if (targetColumnIndex === sourceIndex) return;
          onOperationRef.current({
            type: "move-column-to",
            rowIndex: hoverRef.current.rowIndex ?? firstMovableRow,
            columnIndex: sourceIndex,
            targetColumnIndex,
          });
          return;
        }
        const bodyRows = getBodyRows();
        const sourcePosition = bodyRows.findIndex((row) => Number(row.dataset.csvRow) === sourceIndex);
        if (sourcePosition < 0) return;
        const targetBoundary = dropBoundary < bodyRows.length
          ? Number(bodyRows[dropBoundary]?.dataset.csvRow)
          : Number(bodyRows[bodyRows.length - 1]?.dataset.csvRow) + 1;
        const targetRowIndex = targetBoundary > sourceIndex ? targetBoundary - 1 : targetBoundary;
        if (!Number.isInteger(targetRowIndex) || targetRowIndex === sourceIndex) return;
        onOperationRef.current({
          type: "move-row-to",
          rowIndex: sourceIndex,
          columnIndex: hoverRef.current.columnIndex ?? 0,
          targetRowIndex,
        });
      };
      const cleanup = (preserveSourceHighlight = false) => {
        if (activeDragCleanupRef.current !== cleanup) return;
        activeDragCleanupRef.current = null;
        hoverRef.current.dragging = false;
        handle.classList.remove("is-dragging");
        surface.classList.remove("is-table-dragging");
        dropIndicator.hidden = true;
        if (!preserveSourceHighlight) setCsvTableSourceHighlight(table, kind, sourceIndex, false, selection);
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerCancel);
        table.ownerDocument.removeEventListener("keydown", onKeyDown, true);
        if (!disposed) positionHandles();
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        upEvent.preventDefault();
        upEvent.stopPropagation();
        const shouldApply = moved;
        cleanup(!shouldApply);
        if (shouldApply) applyMove();
        else openMenu(kind, sourceIndex, handle);
      };
      const onPointerCancel = (cancelEvent: PointerEvent) => {
        cancelEvent.preventDefault();
        cancelEvent.stopPropagation();
        cleanup();
      };
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        cleanup();
      };

      activeDragCleanupRef.current = cleanup;
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerCancel);
      table.ownerDocument.addEventListener("keydown", onKeyDown, true);
    };
    startDragRef.current = startDrag;

    const updateHoverFromEvent = (event: PointerEvent) => {
      if (disposed || hoverRef.current.dragging || menuTargetRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const recordIndexCell = target.closest<HTMLTableCellElement>("[data-csv-record-index]");
      if (recordIndexCell && table.contains(recordIndexCell)) {
        const nextRowIndex = Number(recordIndexCell.dataset.csvRecordIndex);
        if (!Number.isInteger(nextRowIndex)) return;
        if (nextRowIndex === hoverRef.current.rowIndex && hoverRef.current.columnIndex == null) return;
        hoverRef.current.rowIndex = nextRowIndex;
        hoverRef.current.columnIndex = null;
        positionHandles(true);
        return;
      }
      const cell = target.closest<HTMLTableCellElement>("td[data-csv-row][data-csv-column], th[data-csv-row][data-csv-column]");
      if (!cell || !table.contains(cell)) return;
      const nextRowIndex = Number(cell.dataset.csvRow);
      const nextColumnIndex = Number(cell.dataset.csvColumn);
      if (!Number.isInteger(nextRowIndex) || !Number.isInteger(nextColumnIndex)) return;
      if (nextRowIndex === hoverRef.current.rowIndex && nextColumnIndex === hoverRef.current.columnIndex) return;
      hoverRef.current.rowIndex = nextRowIndex;
      hoverRef.current.columnIndex = nextColumnIndex;
      positionHandles(true);
    };
    const clearHover = () => {
      if (disposed || hoverRef.current.dragging || menuTargetRef.current) return;
      hoverRef.current.rowIndex = null;
      hoverRef.current.columnIndex = null;
      positionHandles();
    };
    table.addEventListener("pointerover", updateHoverFromEvent);
    table.addEventListener("contextmenu", openCellMenu);
    surface.addEventListener("pointerleave", clearHover);
    // No layout is read when no handle is active; an active handle stays
    // pixel-synchronous with the existing sticky interaction contract.
    const onScroll = () => positionHandles();
    scrollContainer?.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePositionHandles);
    resizeObserver?.observe(table);
    positionHandles();

    return () => {
      disposed = true;
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = null;
      table.removeEventListener("pointerover", updateHoverFromEvent);
      table.removeEventListener("contextmenu", openCellMenu);
      surface.removeEventListener("pointerleave", clearHover);
      scrollContainer?.removeEventListener("scroll", onScroll);
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      positionFrame = null;
      resizeObserver?.disconnect();
      selection.dispose();
      if (selectionRef.current === selection) selectionRef.current = null;
      setColumnHandleDocked(null, false);
      setRowHandleDocked(null, false);
      setCsvTableSourceHighlight(table, "row", menuTargetRef.current?.rowIndex ?? -1, false);
      setCsvTableSourceHighlight(table, "column", menuTargetRef.current?.columnIndex ?? -1, false);
      positionHandlesRef.current = () => undefined;
      openMenuRef.current = () => undefined;
      startDragRef.current = () => undefined;
    };
  }, [closeMenu, direction, headerEnabled, rowCount, rowNumbersVisible, surfaceRef, t, tableRef]);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, kind: CsvTableDragKind) => {
    startDragRef.current(event.nativeEvent, kind);
  };
  const openContextMenu = (event: React.MouseEvent<HTMLButtonElement>, kind: CsvTableDragKind) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = kind === "column" ? hoverRef.current.columnIndex : hoverRef.current.rowIndex;
    if (sourceIndex == null) return;
    openMenuRef.current(kind, sourceIndex, event.currentTarget);
  };

  return (
    <>
      <div className="po-editable-table-drag-layer csv-table-editor__drag-layer">
        <button
          ref={columnHandleRef}
          type="button"
          className="po-editable-table-drag-handle po-editable-table-column-handle csv-table-editor__column-handle"
          tabIndex={-1}
          aria-expanded="false"
          aria-haspopup="menu"
          title={t("editor.table.columnHandleHint")}
          onPointerDown={(event) => startDrag(event, "column")}
          onContextMenu={(event) => openContextMenu(event, "column")}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="po-editable-table-drag-handle-visual" aria-hidden="true" />
        </button>
        <button
          ref={rowHandleRef}
          type="button"
          className="po-editable-table-drag-handle po-editable-table-row-handle csv-table-editor__row-handle"
          tabIndex={-1}
          aria-expanded="false"
          aria-haspopup="menu"
          title={t("editor.table.rowHandleHint")}
          onPointerDown={(event) => startDrag(event, "row")}
          onContextMenu={(event) => openContextMenu(event, "row")}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="po-editable-table-drag-handle-visual" aria-hidden="true" />
        </button>
        <div
          ref={dropIndicatorRef}
          className="po-editable-table-drop-indicator csv-table-editor__drop-indicator"
          hidden
        />
      </div>

      {menuTarget && (
        <CsvTableMenu
          columnCount={columnCount}
          direction={direction}
          headerEnabled={headerEnabled}
          locale={locale}
          onAutoFitColumn={onAutoFitColumn}
          onClose={closeMenu}
          onOperation={onOperation}
          rowCount={rowCount}
          t={t}
          target={menuTarget}
        />
      )}
    </>
  );
}

function setCsvTableSourceHighlight(
  table: HTMLTableElement,
  kind: CsvTableDragKind,
  sourceIndex: number,
  active: boolean,
  selection?: ReturnType<typeof createEditableTableSelection> | null,
) {
  if (active) selection?.show(kind, () => table.querySelector<HTMLElement>(kind === "row"
    ? `tbody tr[data-csv-row="${sourceIndex}"]` : `th[data-csv-column="${sourceIndex}"], td[data-csv-column="${sourceIndex}"]`));
  else selection?.clear();
  if (kind === "row") {
    const row = table.querySelector<HTMLTableRowElement>(`tbody tr[data-csv-row="${sourceIndex}"]`);
    if (!row) return;
    for (const cell of Array.from(row.cells)) {
      cell.classList.toggle("po-editable-table-drag-source", active);
    }
    return;
  }
  for (const row of Array.from(table.rows)) {
    row
      .querySelector<HTMLTableCellElement>(`[data-csv-column="${sourceIndex}"]`)
      ?.classList.toggle("po-editable-table-drag-source", active);
  }
}
