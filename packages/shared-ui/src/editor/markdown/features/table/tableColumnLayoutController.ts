import { clampEmbeddedTableColumnWidth } from "../../platform/codemirror/embeddedTableColumnGeometry";
import type { MarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import type { EmbeddedTableColumnLayoutSession } from "../../platform/codemirror/embeddedTableColumnLayoutSession";
import type { MarkdownTableAlignment, MarkdownTableRow } from "./tableModel";
import {
  DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS,
  estimateMarkdownTableColumnWidth,
  fitMarkdownTableColumnWidths,
  layoutMarkdownTableColumns,
  measureMarkdownTableColumns,
  type MarkdownTableColumnContent,
  type MarkdownTableLayoutMetrics,
} from "./markdownTableColumnLayout";
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
  /** Settles horizontal overflow after the table changes its own tracks. */
  settleOverflow?: () => void;
  surface: HTMLElement;
  table: HTMLTableElement;
  wrapper: HTMLElement;
}>;

/**
 * DOM adapter for one table's column tracks. Automatic tracks follow the
 * reading column: they reflow whenever its width changes, never while a cell
 * is edited. Explicit tracks come from the progressively disclosed resize
 * rail (or auto-fit / fit-to-viewport): pointer moves only update the <col>
 * track, and the semantic View State is committed once at the gesture
 * boundary, outside Markdown source and undo history.
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
  handle.setAttribute("aria-label", context.resizeHint);
  resizeLayer.appendChild(handle);
  context.surface.appendChild(resizeLayer);

  let widths = [...context.session.widths];
  let explicit = context.session.explicit;
  let autoLayoutWidth = context.session.autoLayoutWidth;
  let columnContents: MarkdownTableColumnContent[] | null = null;
  let reflowFrame: number | null = null;
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
    widths = nextWidths.map(clampEmbeddedTableColumnWidth);
    explicit = true;
    autoLayoutWidth = null;
    applyWidths(widths);
    context.host.tableColumnLayouts.setWidths(
      context.session.sessionId,
      context.session.mountToken,
      widths,
    );
    context.host.requestMeasure();
    positionHandle();
  };

  /**
   * The reading column the table may fill. The frame's inline padding is the
   * interaction rail outside the reading column, which already holds the
   * add-column action, so a fitted table aligns with the text edges.
   */
  const measureAvailableWidth = () => {
    const styles = ownerWindow?.getComputedStyle(context.frame);
    const paddingStart = Number.parseFloat(styles?.paddingInlineStart ?? "0") || 0;
    const paddingEnd = Number.parseFloat(styles?.paddingInlineEnd ?? "0") || 0;
    return Math.max(0, context.scrollport.clientWidth - paddingStart - paddingEnd);
  };

  const measureLayoutMetrics = (): MarkdownTableLayoutMetrics | null => {
    const availableWidth = measureAvailableWidth();
    if (!ownerWindow || availableWidth <= 0) return null;
    const fontSize = Number.parseFloat(ownerWindow.getComputedStyle(context.table).fontSize);
    const cellContent = context.table.querySelector<HTMLElement>(".cm-md-table-cell-content");
    const cellStyles = cellContent ? ownerWindow.getComputedStyle(cellContent) : null;
    const cellInset = (Number.parseFloat(cellStyles?.paddingLeft ?? "") || 0)
      + (Number.parseFloat(cellStyles?.paddingRight ?? "") || 0)
      + 1;
    if (!Number.isFinite(fontSize) || fontSize <= 0) return null;
    return { availableWidth, emPx: fontSize, cellInset };
  };

  /** Lay automatic tracks out for one reading column. */
  const applyAutomaticLayout = (metrics: MarkdownTableLayoutMetrics) => {
    columnContents ??= measureMarkdownTableColumns(context.rows, context.alignments.length);
    const nextWidths = layoutMarkdownTableColumns(columnContents, metrics);
    autoLayoutWidth = metrics.availableWidth;
    context.host.tableColumnLayouts.setAutoWidths(
      context.session.sessionId,
      context.session.mountToken,
      nextWidths,
      metrics.availableWidth,
    );
    if (nextWidths.length === widths.length && nextWidths.every((width, index) => width === widths[index])) return;
    widths = nextWidths;
    applyWidths(widths);
    context.settleOverflow?.();
    context.host.requestMeasure();
    positionHandle();
  };

  /**
   * Follow the reading column. Only a changed width reflows, so re-rendering
   * a table while a cell is edited never moves its columns.
   */
  const reflowAutomaticWidths = () => {
    if (disposed || explicit || activeResizeCleanup) return;
    const metrics = measureLayoutMetrics();
    if (!metrics) return;
    context.host.tableColumnLayouts.rememberAutoLayoutMetrics(metrics);
    if (autoLayoutWidth !== null && Math.abs(metrics.availableWidth - autoLayoutWidth) < 1) return;
    applyAutomaticLayout(metrics);
  };

  const scheduleReflow = () => {
    if (reflowFrame !== null || disposed) return;
    if (!ownerWindow) {
      reflowAutomaticWidths();
      return;
    }
    reflowFrame = ownerWindow.requestAnimationFrame(() => {
      reflowFrame = null;
      reflowAutomaticWidths();
    });
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
    const metrics = measureLayoutMetrics()
      ?? context.host.tableColumnLayouts.getAutoLayoutMetrics()
      ?? undefined;
    next[columnIndex] = estimateMarkdownTableColumnWidth(context.rows, columnIndex, metrics);
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
      currentWidth = clampEmbeddedTableColumnWidth(startWidth + delta);
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
  // The reading column, not the table: automatic tracks follow its width.
  const readingColumnObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(scheduleReflow);
  readingColumnObserver?.observe(context.wrapper);

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
      readingColumnObserver?.disconnect();
      if (positionFrame !== null) ownerWindow?.cancelAnimationFrame(positionFrame);
      positionFrame = null;
      if (reflowFrame !== null) ownerWindow?.cancelAnimationFrame(reflowFrame);
      reflowFrame = null;
      resizeLayer.remove();
      context.host.tableColumnLayouts.detach(
        context.session.sessionId,
        context.session.mountToken,
      );
    },

    fitToViewport() {
      commitWidths(fitMarkdownTableColumnWidths(widths, measureAvailableWidth()));
    },

    /** Back to automatic tracks that follow the reading column. */
    resetColumnWidths() {
      context.host.tableColumnLayouts.resetToAuto(
        context.session.sessionId,
        context.session.mountToken,
      );
      explicit = false;
      applyAutomaticLayout(
        measureLayoutMetrics()
          ?? context.host.tableColumnLayouts.getAutoLayoutMetrics()
          ?? DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS,
      );
    },
  };
}
