import { showEditableTableHandle } from "../../../table/editableTableHandle";
import { createEditableTableSelection } from "../../../table/editableTableSelection";
import type { EditorView } from "@codemirror/view";
import type { MarkdownTableAlignment, MarkdownTableRow } from "./tableModel";
import { stopCodeMirrorEvent } from "../../shared/widgets/widgetDom";
import { showMarkdownTableContextMenu } from "./tableContextMenu";
import {
  dispatchMarkdownTableStructureOperation,
  getActiveMarkdownTableCellDraft,
  type MarkdownTableDispatchContext,
} from "./tableCommands";
import {
  closeActiveMarkdownTableMenu,
  hasActiveMarkdownTableMenu,
  isActiveMarkdownTableMenu,
} from "./tableMenuState";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import {
  getEditableTableColumnDropBoundary,
  getEditableTableDropBoundary,
} from "../../../table/editableTableDrag";
import type { MarkdownTableInlineViewportController } from "./tableInlineViewportController";
import type { MarkdownTableColumnLayoutController } from "./tableColumnLayoutController";

export type MarkdownTableDragHandleContext = {
  alignments: readonly MarkdownTableAlignment[];
  columnCount: number;
  columnLayout: MarkdownTableColumnLayoutController | null;
  inlineViewport: MarkdownTableInlineViewportController;
  rows: readonly MarkdownTableRow[];
  table: HTMLTableElement;
  getTableRange: () => { from: number; to: number } | null;
  view: EditorView;
  wrapper: HTMLElement;
};

type MarkdownTableDragKind = "column" | "row";

export type MarkdownTableDragLayer = {
  dispose: () => void;
  element: HTMLElement;
};

export function createMarkdownTableDragLayer(context: MarkdownTableDragHandleContext): MarkdownTableDragLayer {
  const localization = getMarkdownLocalization(context.view);
  const doc = context.table.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = "cm-md-table-drag-layer po-editable-table-drag-layer";
  if (context.view.state.readOnly) {
    return { dispose() {}, element: layer };
  }

  const columnHandle = createMarkdownTableHandleElement(
    doc,
    "column",
    localization.t("editor.table.columnHandleHint"),
  );
  const rowHandle = createMarkdownTableHandleElement(
    doc,
    "row",
    localization.t("editor.table.rowHandleHint"),
  );
  const dropIndicator = doc.createElement("div");
  dropIndicator.className = "cm-md-table-drop-indicator po-editable-table-drop-indicator";
  dropIndicator.hidden = true;
  layer.append(columnHandle, rowHandle, dropIndicator);
  const selection = createEditableTableSelection(context.table.parentElement!, context.table);

  // Single handle pair driven by the hovered cell: the row handle straddles
  // the left border of the hovered row, the column handle straddles the top
  // border of the hovered column. The header row is fixed and gets no row
  // handle. Visibility is class-driven (not [hidden]) so show/hide can fade
  // while pointer retargeting glides between cells.
  const hover: { columnIndex: number | null; rowIndex: number | null; dragging: boolean } = {
    columnIndex: null,
    rowIndex: null,
    dragging: false,
  };
  let activeDragCleanup: (() => void) | null = null;
  let disposed = false;
  let ownedMenu: HTMLElement | null = null;

  const getBodyRowElements = () => Array.from(
    context.table.querySelectorAll<HTMLTableRowElement>("tbody tr[data-md-table-row]"),
  );
  const getHeaderCellElements = () => Array.from(context.table.querySelectorAll<HTMLTableCellElement>("thead th"));

  const setHandleVisible = (handle: HTMLElement, visible: boolean) => {
    handle.classList.toggle("is-visible", visible);
  };

  const positionHandles = (followPointer = false) => {
    if (disposed) return;
    const surface = layer.parentElement;
    if (!surface || !layer.isConnected) return;
    const surfaceRect = surface.getBoundingClientRect();

    const headerCell = hover.columnIndex == null ? null : getHeaderCellElements()[hover.columnIndex] ?? null;
    if (headerCell && hover.columnIndex != null) {
      const rect = headerCell.getBoundingClientRect();
      showEditableTableHandle(columnHandle, `${rect.left - surfaceRect.left + rect.width / 2}px`, "0px", followPointer);
      columnHandle.setAttribute(
        "aria-label",
        localization.t("editor.table.columnActions", {
          column: hover.columnIndex + 1,
        }),
      );
    } else {
      setHandleVisible(columnHandle, false);
    }

    const bodyRow = hover.rowIndex == null || hover.rowIndex < 1
      ? null
      : getBodyRowElements().find((row) => Number(row.dataset.mdTableRow) === hover.rowIndex) ?? null;
    if (bodyRow && hover.rowIndex != null) {
      const rect = bodyRow.getBoundingClientRect();
      if (localization.direction === "rtl") {
        rowHandle.style.right = "0px";
        showEditableTableHandle(rowHandle, "", `${rect.top - surfaceRect.top + rect.height / 2}px`, followPointer);
      } else {
        rowHandle.style.removeProperty("right");
        showEditableTableHandle(rowHandle, "0px", `${rect.top - surfaceRect.top + rect.height / 2}px`, followPointer);
      }
      rowHandle.setAttribute(
        "aria-label",
        localization.t("editor.table.rowActions", { row: hover.rowIndex }),
      );
    } else {
      setHandleVisible(rowHandle, false);
    }
  };

  const updateHoverFromEvent = (event: Event) => {
    if (disposed || hover.dragging || ownedMenu) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest("td, th");
    if (!(cell instanceof HTMLTableCellElement) || !context.table.contains(cell)) return;
    const rowElement = cell.parentElement;
    if (!(rowElement instanceof HTMLTableRowElement)) return;
    const nextColumnIndex = cell.cellIndex;
    const nextRowIndex = cell.tagName === "TH"
      ? 0
      : Number.parseInt(rowElement.dataset.mdTableRow ?? "", 10);
    if (!Number.isInteger(nextRowIndex)) return;
    if (nextColumnIndex === hover.columnIndex && nextRowIndex === hover.rowIndex) return;
    hover.columnIndex = nextColumnIndex;
    hover.rowIndex = nextRowIndex;
    positionHandles(true);
  };

  const clearHover = () => {
    if (disposed || hover.dragging || hasActiveMarkdownTableMenu()) return;
    hover.columnIndex = null;
    hover.rowIndex = null;
    positionHandles();
  };

  context.table.addEventListener("pointerover", updateHoverFromEvent);
  context.wrapper.addEventListener("pointerleave", clearHover);

  const buildDispatchContext = (): MarkdownTableDispatchContext | null => {
    const tableRange = context.getTableRange();
    return tableRange
      ? {
          alignments: context.alignments,
          currentDraft: getActiveMarkdownTableCellDraft(context.wrapper),
          rows: context.rows,
          tableFrom: tableRange.from,
          tableTo: tableRange.to,
          view: context.view,
        }
      : null;
  };

  const openHandleMenu = (kind: MarkdownTableDragKind, sourceIndex: number, handle: HTMLElement) => {
    const dispatchContext = buildDispatchContext();
    if (!dispatchContext) return;
    closeActiveMarkdownTableMenu();
    positionHandles();
    setInteractionPinnedRow(kind === "row" ? sourceIndex : hover.rowIndex);
    setDragSourceHighlight(kind, sourceIndex, true);
    handle.classList.add("is-menu-active");
    // The button is deliberately larger than the visible grip. Anchor menus
    // to the grip so increasing hit slop never makes the menu drift away.
    const anchor = handle.querySelector<HTMLElement>(".cm-md-table-drag-handle-visual") ?? handle;
    const rect = anchor.getBoundingClientRect();
    let nextMenu: HTMLElement | null = null;
    nextMenu = showMarkdownTableContextMenu(dispatchContext, {
      clientX: kind === "row"
        ? localization.direction === "rtl" ? rect.left - 4 : rect.right + 4
        : rect.left,
      clientY: kind === "row" ? rect.top : rect.bottom + 4,
      columnCount: context.columnCount,
      columnIndex: kind === "column" ? sourceIndex : hover.columnIndex ?? 0,
      layoutActions: kind === "column" && context.columnLayout
        ? {
            autoFitColumn: () => context.columnLayout?.autoFitColumn(sourceIndex),
            fitToViewport: () => context.columnLayout?.fitToViewport(),
            resetColumnWidths: () => context.columnLayout?.resetColumnWidths(),
          }
        : undefined,
      onClose: () => {
        setDragSourceHighlight(kind, sourceIndex, false);
        handle.classList.remove("is-menu-active");
        handle.setAttribute("aria-expanded", "false");
        handle.removeAttribute("aria-controls");
        setInteractionPinnedRow(null);
        if (ownedMenu === nextMenu) ownedMenu = null;
        if (!disposed) positionHandles();
      },
      rowCount: context.rows.length,
      rowIndex: kind === "row" ? sourceIndex : hover.rowIndex ?? 0,
      scope: kind,
    });
    ownedMenu = nextMenu;
    handle.setAttribute("aria-controls", nextMenu.id);
    handle.setAttribute("aria-expanded", "true");
  };

  const setDragSourceHighlight = (kind: MarkdownTableDragKind, sourceIndex: number, active: boolean) => {
    if (active) selection.show(kind, () => kind === "column"
      ? getHeaderCellElements()[sourceIndex] ?? null
      : getBodyRowElements().find(row => Number(row.dataset.mdTableRow) === sourceIndex) ?? null);
    else selection.clear();
    if (kind === "row") {
      const row = getBodyRowElements().find(
        (candidate) => Number(candidate.dataset.mdTableRow) === sourceIndex,
      );
      if (!row) return;
      for (const cell of Array.from(row.cells)) {
        cell.classList.toggle("cm-md-table-drag-source", active);
        cell.classList.toggle("po-editable-table-drag-source", active);
      }
      return;
    }
    for (const row of [...getHeaderCellElements().map((cell) => cell.parentElement), ...getBodyRowElements()]) {
      if (!(row instanceof HTMLTableRowElement)) continue;
      const cell = row.cells[sourceIndex];
      cell?.classList.toggle("cm-md-table-drag-source", active);
      cell?.classList.toggle("po-editable-table-drag-source", active);
    }
  };

  const renderDropIndicator = (kind: MarkdownTableDragKind, sourceIndex: number, boundary: number | null) => {
    const surface = layer.parentElement;
    if (!surface || boundary == null) {
      dropIndicator.hidden = true;
      return;
    }
    const surfaceRect = surface.getBoundingClientRect();
    const tableRect = context.table.getBoundingClientRect();

    if (kind === "row") {
      const bodyRows = getBodyRowElements();
      const sourceBodyIndex = sourceIndex - 1;
      const finalIndex = boundary > sourceBodyIndex ? boundary - 1 : boundary;
      if (finalIndex === sourceBodyIndex || bodyRows.length === 0) {
        dropIndicator.hidden = true;
        return;
      }
      const nextRow = bodyRows.find(
        (row) => Number(row.dataset.mdTableRow) - 1 === boundary,
      );
      const previousRow = bodyRows.find(
        (row) => Number(row.dataset.mdTableRow) - 1 === boundary - 1,
      );
      const y = nextRow?.getBoundingClientRect().top
        ?? previousRow?.getBoundingClientRect().bottom;
      if (y == null) {
        dropIndicator.hidden = true;
        return;
      }
      dropIndicator.hidden = false;
      dropIndicator.className = "cm-md-table-drop-indicator po-editable-table-drop-indicator is-row";
      dropIndicator.style.left = `${tableRect.left - surfaceRect.left}px`;
      dropIndicator.style.top = `${y - surfaceRect.top}px`;
      dropIndicator.style.width = `${tableRect.width}px`;
      dropIndicator.style.height = "";
      return;
    }

    const headerCells = getHeaderCellElements();
    const finalIndex = boundary > sourceIndex ? boundary - 1 : boundary;
    if (finalIndex === sourceIndex || headerCells.length === 0) {
      dropIndicator.hidden = true;
      return;
    }
    const x = localization.direction === "rtl"
      ? boundary < headerCells.length
        ? headerCells[boundary].getBoundingClientRect().right
        : headerCells[headerCells.length - 1].getBoundingClientRect().left
      : boundary < headerCells.length
        ? headerCells[boundary].getBoundingClientRect().left
        : headerCells[headerCells.length - 1].getBoundingClientRect().right;
    dropIndicator.hidden = false;
    dropIndicator.className = "cm-md-table-drop-indicator po-editable-table-drop-indicator is-column";
    dropIndicator.style.left = `${x - surfaceRect.left}px`;
    dropIndicator.style.top = `${tableRect.top - surfaceRect.top}px`;
    dropIndicator.style.width = "";
    dropIndicator.style.height = `${tableRect.height}px`;
  };

  const startHandleDrag = (event: PointerEvent, kind: MarkdownTableDragKind) => {
    if (disposed || event.button !== 0) return;
    const sourceIndex = kind === "column" ? hover.columnIndex : hover.rowIndex;
    if (sourceIndex == null) return;
    event.preventDefault();
    event.stopPropagation();
    closeActiveMarkdownTableMenu();
    activeDragCleanup?.();

    const handle = kind === "column" ? columnHandle : rowHandle;
    const otherHandle = kind === "column" ? rowHandle : columnHandle;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let dropBoundary: number | null = null;
    let lastClientX = startX;
    let lastClientY = startY;

    hover.dragging = true;
    positionHandles();
    setInteractionPinnedRow(kind === "row" ? sourceIndex : hover.rowIndex);
    handle.setPointerCapture(pointerId);
    setDragSourceHighlight(kind, sourceIndex, true);

    const beginVisualDrag = () => {
      handle.classList.add("is-dragging");
      setHandleVisible(otherHandle, false);
      context.wrapper.classList.add("is-table-dragging");
    };

    const updateDropBoundary = () => {
      dropBoundary = kind === "column"
        ? getEditableTableColumnDropBoundary(
          getHeaderCellElements(),
          lastClientX,
          localization.direction,
        )
        : getEditableTableDropBoundary(getBodyRowElements().map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            boundary: Number(row.dataset.mdTableRow) - 1,
            start: rect.top,
            size: rect.height,
          };
        }), lastClientY);
      renderDropIndicator(kind, sourceIndex, dropBoundary);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      if (!moved) {
        if (Math.abs(moveEvent.clientX - startX) <= 4 && Math.abs(moveEvent.clientY - startY) <= 4) return;
        moved = true;
        beginVisualDrag();
      }
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;
      updateDropBoundary();
      if (kind === "column") {
        context.inlineViewport.updateDragAutoScroll(lastClientX, updateDropBoundary);
      }
    };

    const applyMove = () => {
      if (dropBoundary == null) return;
      const dispatchContext = buildDispatchContext();
      if (!dispatchContext) return;
      if (kind === "column") {
        const targetColumnIndex = dropBoundary > sourceIndex ? dropBoundary - 1 : dropBoundary;
        if (targetColumnIndex === sourceIndex) return;
        dispatchMarkdownTableStructureOperation(dispatchContext, {
          type: "move-column-to",
          rowIndex: hover.rowIndex ?? 0,
          columnIndex: sourceIndex,
          targetColumnIndex,
        });
        return;
      }
      const sourceBodyIndex = sourceIndex - 1;
      const targetBodyIndex = dropBoundary > sourceBodyIndex ? dropBoundary - 1 : dropBoundary;
      if (targetBodyIndex === sourceBodyIndex) return;
      dispatchMarkdownTableStructureOperation(dispatchContext, {
        type: "move-row-to",
        rowIndex: sourceIndex,
        columnIndex: hover.columnIndex ?? 0,
        targetRowIndex: targetBodyIndex + 1,
      });
    };

    const cleanup = ({ preserveSourceHighlight = false }: { preserveSourceHighlight?: boolean } = {}) => {
      if (activeDragCleanup !== cleanup) return;
      activeDragCleanup = null;
      hover.dragging = false;
      handle.classList.remove("is-dragging");
      context.wrapper.classList.remove("is-table-dragging");
      context.inlineViewport.stopDragAutoScroll();
      setInteractionPinnedRow(null);
      dropIndicator.hidden = true;
      if (!preserveSourceHighlight) setDragSourceHighlight(kind, sourceIndex, false);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      doc.removeEventListener("keydown", onKeyDown, true);
      if (!disposed) positionHandles();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      const shouldApply = moved;
      cleanup({ preserveSourceHighlight: !shouldApply });
      if (!shouldApply) {
        openHandleMenu(kind, sourceIndex, handle);
        return;
      }
      applyMove();
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

    activeDragCleanup = cleanup;
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    doc.addEventListener("keydown", onKeyDown, true);
  };

  const bindHandle = (handle: HTMLButtonElement, kind: MarkdownTableDragKind) => {
    handle.addEventListener("pointerdown", (event) => startHandleDrag(event, kind));
    handle.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceIndex = kind === "column" ? hover.columnIndex : hover.rowIndex;
      if (sourceIndex == null) return;
      openHandleMenu(kind, sourceIndex, handle);
    });
    handle.addEventListener("mousedown", stopCodeMirrorEvent);
    handle.addEventListener("click", stopCodeMirrorEvent);
  };
  bindHandle(columnHandle, "column");
  bindHandle(rowHandle, "row");

  const setInteractionPinnedRow = (rowIndex: number | null | undefined) => {
    if (rowIndex != null && Number.isInteger(rowIndex) && rowIndex > 0) {
      context.wrapper.dataset.mdTablePinnedRow = String(rowIndex);
    } else {
      delete context.wrapper.dataset.mdTablePinnedRow;
    }
  };

  return {
    element: layer,
    dispose() {
      if (disposed) return;
      disposed = true;
      activeDragCleanup?.();
      context.table.removeEventListener("pointerover", updateHoverFromEvent);
      context.wrapper.removeEventListener("pointerleave", clearHover);
      if (ownedMenu && isActiveMarkdownTableMenu(ownedMenu)) {
        closeActiveMarkdownTableMenu();
      }
      ownedMenu = null;
      selection.dispose();
      setInteractionPinnedRow(null);
    },
  };
}

function createMarkdownTableHandleElement(
  doc: Document,
  kind: MarkdownTableDragKind,
  title: string,
): HTMLButtonElement {
  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = [
    "cm-md-table-drag-handle",
    `cm-md-table-${kind}-handle`,
    "po-editable-table-drag-handle",
    `po-editable-table-${kind}-handle`,
  ].join(" ");
  // Pointer-only affordance: it fades with hover, so keep it out of the tab
  // order (the context menu covers keyboard access to the same operations).
  handle.tabIndex = -1;
  handle.setAttribute("aria-expanded", "false");
  handle.setAttribute("aria-haspopup", "menu");
  handle.title = title;
  const visual = doc.createElement("span");
  visual.className = "cm-md-table-drag-handle-visual po-editable-table-drag-handle-visual";
  visual.setAttribute("aria-hidden", "true");
  handle.appendChild(visual);
  return handle;
}
