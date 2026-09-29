import { activateTooltip } from "../../../../primitives/Tooltip";
import {
  EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
  clampEditableTableColumnWidth,
  fitEditableTableColumnWidths,
} from "../../../table/editableTableLayout";
import type { MarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import type { EmbeddedTableColumnLayoutSession } from "../../platform/codemirror/embeddedTableColumnLayoutSession";
import type { MarkdownTableAlignment, MarkdownTableRow } from "./tableModel";
import {
  estimateMarkdownTableColumnWidth,
  estimateMarkdownTableColumnWidths,
} from "./tableLayout";
import { closeActiveMarkdownTableMenu } from "./tableMenuState";

export type MarkdownTableColumnLayoutController = Readonly<{
  autoFitColumn(columnIndex: number): void;
  dispose(): void;
  fitToViewport(): void;
  resetColumnWidths(): void;
}>;

type MarkdownTableColumnLayoutContext = Readonly<{
  alignments: readonly MarkdownTableAlignment[];
  direction: "ltr" | "rtl";
  frame: HTMLElement;
  host: MarkdownEmbedHost;
  resizeColumnLabel: (column: number) => string;
  resizeHint: string;
  rows: readonly MarkdownTableRow[];
  scrollport: HTMLElement;
  session: EmbeddedTableColumnLayoutSession;
  surface: HTMLElement;
  table: HTMLTableElement;
  wrapper: HTMLElement;
}>;

/**
 * DOM adapter for one progressively disclosed resize rail. Pointer moves only
 * update the <col> track; the semantic View State is committed once at the
 * gesture boundary, outside Markdown source and undo history.
 */
export function createMarkdownTableColumnLayoutController(
  context: MarkdownTableColumnLayoutContext,
): MarkdownTableColumnLayoutController {
  const doc = context.table.ownerDocument;
  const ownerWindow = doc.defaultView;
  const resizeLayer = doc.createElement("div");
  resizeLayer.className = "cm-md-table-column-resize-layer";
  resizeLayer.dataset.mdTableColumnResizeLayer = "true";
  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = "cm-md-table-column-resize-handle";
  handle.tabIndex = -1;
  activateTooltip(handle, context.resizeHint);
  resizeLayer.appendChild(handle);
  context.surface.appendChild(resizeLayer);

  let widths = [...context.session.widths];
  let activeColumnIndex: number | null = null;
  let activeResizeCleanup: (() => void) | null = null;
  let positionFrame: number | null = null;
  let disposed = false;

  const getColumnTrack = (columnIndex: number) => context.table.querySelector<HTMLTableColElement>(
    `col[data-md-table-column="${columnIndex}"]`,
  );

  const applyWidths = (nextWidths: readonly number[]) => {
    nextWidths.forEach((width, columnIndex) => {
      const column = getColumnTrack(columnIndex);
      if (column) column.style.width = `${width}px`;
    });
  };

  const commitWidths = (nextWidths: readonly number[]) => {
    widths = nextWidths.map((width) => clampEditableTableColumnWidth(
      width,
      EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
    ));
    applyWidths(widths);
    context.host.tableColumnLayouts.setWidths(
      context.session.sessionId,
      context.session.mountToken,
      widths,
    );
    context.host.requestMeasure();
    positionHandle();
  };

  const positionHandle = () => {
    if (disposed || activeResizeCleanup) return;
    if (activeColumnIndex == null) {
      handle.classList.remove("is-visible");
      return;
    }
    const cell = context.table.rows[0]?.cells[activeColumnIndex] ?? null;
    if (!cell) {
      handle.classList.remove("is-visible");
      return;
    }
    const surfaceRect = context.surface.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const tableRect = context.table.getBoundingClientRect();
    const boundary = context.direction === "rtl" ? cellRect.left : cellRect.right;
    handle.style.left = `${boundary - surfaceRect.left}px`;
    handle.style.top = `${tableRect.top - surfaceRect.top}px`;
    handle.style.height = `${tableRect.height}px`;
    handle.setAttribute(
      "aria-label",
      context.resizeColumnLabel(activeColumnIndex + 1),
    );
    handle.classList.add("is-visible");
  };

  const schedulePosition = () => {
    if (positionFrame !== null) return;
    if (!ownerWindow) {
      positionHandle();
      return;
    }
    positionFrame = ownerWindow.requestAnimationFrame(() => {
      positionFrame = null;
      positionHandle();
    });
  };

  const updateHover = (event: PointerEvent) => {
    if (disposed || activeResizeCleanup || !(event.target instanceof Element)) return;
    const cell = event.target.closest<HTMLTableCellElement>("td, th");
    if (!cell || !context.table.contains(cell)) return;
    const columnIndex = cell.cellIndex;
    if (columnIndex === activeColumnIndex) return;
    activeColumnIndex = columnIndex;
    positionHandle();
  };

  const clearHover = (event: PointerEvent) => {
    if (activeResizeCleanup) return;
    if (event.relatedTarget instanceof Node && handle.contains(event.relatedTarget)) return;
    activeColumnIndex = null;
    handle.classList.remove("is-visible");
  };

  const autoFitColumn = (columnIndex: number) => {
    if (disposed || !Number.isInteger(columnIndex) || !widths[columnIndex]) return;
    const next = [...widths];
    next[columnIndex] = estimateMarkdownTableColumnWidth(context.rows, columnIndex);
    commitWidths(next);
  };

  const startResize = (event: PointerEvent) => {
    const columnIndex = activeColumnIndex;
    const startWidth = columnIndex == null ? undefined : widths[columnIndex];
    if (disposed || event.button !== 0 || columnIndex == null || startWidth == null) return;
    event.preventDefault();
    event.stopPropagation();
    closeActiveMarkdownTableMenu();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startLeft = Number.parseFloat(handle.style.left) || 0;
    const columnTrack = getColumnTrack(columnIndex);
    let currentWidth = startWidth;
    activeResizeCleanup?.();
    handle.classList.add("is-resizing");
    context.wrapper.classList.add("is-column-resizing");
    handle.setPointerCapture?.(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const delta = (moveEvent.clientX - startX) * (context.direction === "rtl" ? -1 : 1);
      currentWidth = clampEditableTableColumnWidth(
        startWidth + delta,
        EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
      );
      const physicalDelta = (currentWidth - startWidth) * (context.direction === "rtl" ? -1 : 1);
      handle.style.left = `${startLeft + physicalDelta}px`;
      if (columnTrack) columnTrack.style.width = `${currentWidth}px`;
    };
    const cleanup = () => {
      if (activeResizeCleanup !== cleanup) return;
      activeResizeCleanup = null;
      handle.classList.remove("is-resizing");
      context.wrapper.classList.remove("is-column-resizing");
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      handle.removeEventListener("lostpointercapture", onLostPointerCapture);
      doc.removeEventListener("keydown", onKeyDown, true);
      ownerWindow?.removeEventListener("blur", onWindowBlur);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture?.(pointerId);
    };
    const restore = () => {
      if (columnTrack) columnTrack.style.width = `${startWidth}px`;
      handle.style.left = `${startLeft}px`;
      cleanup();
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      cleanup();
      const next = [...widths];
      next[columnIndex] = currentWidth;
      commitWidths(next);
    };
    const onPointerCancel = (cancelEvent: PointerEvent) => {
      cancelEvent.preventDefault();
      cancelEvent.stopPropagation();
      restore();
    };
    const onLostPointerCapture = () => restore();
    const onWindowBlur = () => restore();
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      restore();
    };
    activeResizeCleanup = cleanup;
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    handle.addEventListener("lostpointercapture", onLostPointerCapture);
    doc.addEventListener("keydown", onKeyDown, true);
    ownerWindow?.addEventListener("blur", onWindowBlur);
  };

  handle.addEventListener("pointerdown", startResize);
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeColumnIndex != null) autoFitColumn(activeColumnIndex);
  });
  context.table.addEventListener("pointerover", updateHover);
  context.surface.addEventListener("pointerleave", clearHover);
  context.scrollport.addEventListener("scroll", positionHandle, { passive: true });
  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(schedulePosition);
  resizeObserver?.observe(context.table);

  return {
    autoFitColumn,

    dispose() {
      if (disposed) return;
      disposed = true;
      activeResizeCleanup?.();
      handle.removeEventListener("pointerdown", startResize);
      context.table.removeEventListener("pointerover", updateHover);
      context.surface.removeEventListener("pointerleave", clearHover);
      context.scrollport.removeEventListener("scroll", positionHandle);
      resizeObserver?.disconnect();
      if (positionFrame !== null) ownerWindow?.cancelAnimationFrame(positionFrame);
      positionFrame = null;
      resizeLayer.remove();
      context.host.tableColumnLayouts.detach(
        context.session.sessionId,
        context.session.mountToken,
      );
    },

    fitToViewport() {
      const styles = ownerWindow?.getComputedStyle(context.frame);
      const surfaceStyles = ownerWindow?.getComputedStyle(context.surface);
      const paddingStart = Number.parseFloat(styles?.paddingInlineStart ?? "0") || 0;
      const paddingEnd = Number.parseFloat(styles?.paddingInlineEnd ?? "0") || 0;
      const actionGutter = Number.parseFloat(
        surfaceStyles?.getPropertyValue("--po-editable-table-action-gutter") ?? "0",
      ) || 0;
      const availableWidth = Math.max(
        0,
        context.scrollport.clientWidth - paddingStart - paddingEnd - actionGutter,
      );
      commitWidths(fitEditableTableColumnWidths(
        widths,
        availableWidth,
        EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
      ));
    },

    resetColumnWidths() {
      commitWidths(estimateMarkdownTableColumnWidths(context.alignments, context.rows));
    },
  };
}
