import type { EditorView } from "@codemirror/view";
import type { MarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { MarkdownBlockVirtualizer } from "../../platform/codemirror/blockVirtualizer";
import type { MarkdownTableRow } from "./tableModel";
import { estimateMarkdownTableRowHeight } from "./tableLayout";

const INITIAL_VIEWPORT_HEIGHT_PX = 900;
const SCROLL_SETTLE_MS = 140;
const FOCUS_REVEAL_PIN_MS = 500;

type MarkdownTableWindowController = {
  dispose(): void;
  revealRow(rowIndex: number): void;
  getMountedRowCount(): number;
};

type TableWindowContext = {
  bodyRowCount: number;
  columnCount: number;
  createRow(bodyIndex: number): HTMLTableRowElement;
  disposeRow(row: HTMLTableRowElement): void;
  getBodyRow(bodyIndex: number): MarkdownTableRow;
  globalRowOffset: number;
  host: MarkdownEmbedHost;
  overscan: number;
  table: HTMLTableElement;
  tbody: HTMLTableSectionElement;
  view: EditorView;
  wrapper: HTMLElement;
};

const controllerByWrapper = new WeakMap<HTMLElement, MarkdownTableWindowController>();

export function createMarkdownTableWindowController(
  context: TableWindowContext,
): MarkdownTableWindowController {
  const virtualizer = new MarkdownBlockVirtualizer(
    context.bodyRowCount,
    (index) => estimateMarkdownTableRowHeight(context.getBodyRow(index)),
  );
  const measureKey = {};
  const anchorMeasureKey = {};
  const rowUnobserve = new Map<number, () => void>();
  const ownerWindow = context.wrapper.ownerDocument.defaultView ?? window;
  let disposed = false;
  let scrolling = false;
  let settleTimer: number | null = null;
  let forcedPinTimer: number | null = null;
  let currentVisibleStartIndex = 0;
  let currentIndexes: readonly number[] = [];
  let geometryRevision = 0;
  let renderedGeometryRevision = -1;
  let pendingAnchorDelta = 0;
  let forcedPinnedBodyIndex: number | null = null;

  const readPinnedBodyIndexes = (): number[] => {
    const indexes = new Set<number>();
    const active = context.wrapper.ownerDocument.activeElement;
    if (active instanceof Element && context.wrapper.contains(active)) {
      const activeCell = active.closest<HTMLElement>("[data-md-table-row]");
      const globalRow = Number(activeCell?.dataset.mdTableRow);
      if (Number.isInteger(globalRow)) indexes.add(globalRow - context.globalRowOffset);
    }
    const interactionRow = Number(context.wrapper.dataset.mdTablePinnedRow);
    if (Number.isInteger(interactionRow)) indexes.add(interactionRow - context.globalRowOffset);
    if (forcedPinnedBodyIndex !== null) indexes.add(forcedPinnedBodyIndex);
    return Array.from(indexes).filter((index) => index >= 0 && index < context.bodyRowCount);
  };

  const readViewport = () => {
    if (!context.wrapper.isConnected) {
      return { start: 0, end: INITIAL_VIEWPORT_HEIGHT_PX, pinned: readPinnedBodyIndexes() };
    }
    const scrollRect = context.view.scrollDOM.getBoundingClientRect();
    const bodyRect = context.tbody.getBoundingClientRect();
    const hasMeasuredViewport = scrollRect.height > 0 && bodyRect.height > 0;
    const start = hasMeasuredViewport ? Math.max(0, scrollRect.top - bodyRect.top) : 0;
    const end = hasMeasuredViewport
      ? Math.max(start + 1, scrollRect.bottom - bodyRect.top)
      : INITIAL_VIEWPORT_HEIGHT_PX;
    return { start, end, pinned: readPinnedBodyIndexes() };
  };

  const schedule = () => {
    if (disposed) return;
    context.host.layout.schedule(measureKey, readViewport, ({ start, end, pinned }) => {
      if (disposed) return;
      const range = virtualizer.getRange(start, end, context.overscan, pinned);
      renderRange(
        range.indexes,
        range.startIndex,
        range.endIndex,
        range.visibleStartIndex,
      );
    });
  };

  const observeRow = (bodyIndex: number, row: HTMLTableRowElement) => {
    rowUnobserve.get(bodyIndex)?.();
    const stop = context.host.layout.observe(row, (height) => {
      if (disposed) return;
      const delta = virtualizer.updateSize(bodyIndex, height);
      if (delta === 0) return;
      geometryRevision += 1;
      if (bodyIndex < currentVisibleStartIndex) pendingAnchorDelta += delta;
      if (!scrolling) scheduleAnchorCorrection();
      schedule();
    });
    rowUnobserve.set(bodyIndex, stop);
  };

  const renderRange = (
    indexes: readonly number[],
    startIndex: number,
    endIndex: number,
    visibleStartIndex: number,
  ) => {
    if (
      disposed
      || (
        sameIndexes(indexes, currentIndexes)
        && renderedGeometryRevision === geometryRevision
      )
    ) return;
    const existingRows = new Map<number, HTMLTableRowElement>();
    for (const row of context.tbody.querySelectorAll<HTMLTableRowElement>("tr[data-md-table-body-index]")) {
      const bodyIndex = Number(row.dataset.mdTableBodyIndex);
      if (Number.isInteger(bodyIndex)) existingRows.set(bodyIndex, row);
    }

    const selected = new Set(indexes);
    for (const [bodyIndex, row] of existingRows) {
      if (selected.has(bodyIndex)) continue;
      rowUnobserve.get(bodyIndex)?.();
      rowUnobserve.delete(bodyIndex);
      context.disposeRow(row);
    }

    const fragment = context.tbody.ownerDocument.createDocumentFragment();
    let cursor = 0;
    for (const bodyIndex of indexes) {
      const gap = virtualizer.getOffset(bodyIndex) - virtualizer.getOffset(cursor);
      if (gap > 0.5) fragment.appendChild(createSpacerRow(context, gap));

      const row = existingRows.get(bodyIndex) ?? context.createRow(bodyIndex);
      row.dataset.mdTableBodyIndex = String(bodyIndex);
      fragment.appendChild(row);
      if (!existingRows.has(bodyIndex)) observeRow(bodyIndex, row);
      cursor = bodyIndex + 1;
    }
    const remaining = virtualizer.getTotalSize() - virtualizer.getOffset(cursor);
    if (remaining > 0.5) fragment.appendChild(createSpacerRow(context, remaining));

    context.tbody.replaceChildren(fragment);
    currentIndexes = [...indexes];
    currentVisibleStartIndex = visibleStartIndex;
    renderedGeometryRevision = geometryRevision;
    context.table.dataset.mdVirtualStart = String(startIndex);
    context.table.dataset.mdVirtualEnd = String(endIndex);
    context.table.dataset.mdMountedRows = String(indexes.length);
    context.host.requestMeasure();
  };

  const scheduleAnchorCorrection = () => {
    if (disposed || Math.abs(pendingAnchorDelta) < 0.5) {
      pendingAnchorDelta = 0;
      return;
    }
    context.host.layout.schedule(anchorMeasureKey, () => ({
      delta: pendingAnchorDelta,
      bodyTop: context.tbody.getBoundingClientRect().top,
      viewportTop: context.view.scrollDOM.getBoundingClientRect().top,
    }), ({ delta, bodyTop, viewportTop }) => {
      if (disposed || scrolling) return;
      pendingAnchorDelta -= delta;
      if (Math.abs(pendingAnchorDelta) < 0.5) pendingAnchorDelta = 0;
      if (bodyTop >= viewportTop) return;
      context.view.scrollDOM.scrollTop += delta;
      const correctionCount = Number(context.table.dataset.mdAnchorCorrections ?? "0") + 1;
      context.table.dataset.mdAnchorCorrections = String(correctionCount);
    });
  };

  const onScroll = () => {
    if (disposed) return;
    scrolling = true;
    if (settleTimer !== null) ownerWindow.clearTimeout(settleTimer);
    settleTimer = ownerWindow.setTimeout(() => {
      settleTimer = null;
      scrolling = false;
      scheduleAnchorCorrection();
      schedule();
    }, SCROLL_SETTLE_MS);
    schedule();
  };
  const onResize = () => schedule();

  const initialCount = Math.min(
    context.bodyRowCount,
    Math.max(1, Math.ceil(INITIAL_VIEWPORT_HEIGHT_PX / 32) + context.overscan),
  );
  const initialIndexes = Array.from({ length: initialCount }, (_, index) => index);
  renderRange(initialIndexes, 0, Math.max(-1, initialCount - 1), 0);

  context.view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  ownerWindow.addEventListener("resize", onResize, { passive: true });

  const controller: MarkdownTableWindowController = {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (settleTimer !== null) ownerWindow.clearTimeout(settleTimer);
      if (forcedPinTimer !== null) ownerWindow.clearTimeout(forcedPinTimer);
      context.view.scrollDOM.removeEventListener("scroll", onScroll);
      ownerWindow.removeEventListener("resize", onResize);
      for (const stop of rowUnobserve.values()) stop();
      rowUnobserve.clear();
      for (const row of context.tbody.querySelectorAll<HTMLTableRowElement>("tr[data-md-table-body-index]")) {
        context.disposeRow(row);
      }
      controllerByWrapper.delete(context.wrapper);
    },
    revealRow(globalRowIndex) {
      const bodyIndex = globalRowIndex - context.globalRowOffset;
      if (bodyIndex < 0 || bodyIndex >= context.bodyRowCount) return;
      forcedPinnedBodyIndex = bodyIndex;
      if (forcedPinTimer !== null) ownerWindow.clearTimeout(forcedPinTimer);
      forcedPinTimer = ownerWindow.setTimeout(() => {
        forcedPinTimer = null;
        forcedPinnedBodyIndex = null;
        schedule();
      }, FOCUS_REVEAL_PIN_MS);
      const bodyRect = context.tbody.getBoundingClientRect();
      const scrollRect = context.view.scrollDOM.getBoundingClientRect();
      const targetTop = bodyRect.top + virtualizer.getOffset(bodyIndex);
      const targetBottom = targetTop + virtualizer.getSize(bodyIndex);
      if (targetTop < scrollRect.top) context.view.scrollDOM.scrollTop -= scrollRect.top - targetTop;
      else if (targetBottom > scrollRect.bottom) context.view.scrollDOM.scrollTop += targetBottom - scrollRect.bottom;
      schedule();
    },
    getMountedRowCount() {
      return currentIndexes.length;
    },
  };
  controllerByWrapper.set(context.wrapper, controller);
  schedule();
  return controller;
}

export function revealMarkdownTableWindowRow(
  wrapper: HTMLElement | null,
  rowIndex: number,
): boolean {
  if (!wrapper) return false;
  const controller = controllerByWrapper.get(wrapper);
  if (!controller) return false;
  controller.revealRow(rowIndex);
  return true;
}

export function getMountedMarkdownTableWindowRowCount(wrapper: HTMLElement | null): number | null {
  return wrapper ? controllerByWrapper.get(wrapper)?.getMountedRowCount() ?? null : null;
}

function createSpacerRow(
  context: Pick<TableWindowContext, "columnCount" | "tbody">,
  height: number,
): HTMLTableRowElement {
  const row = context.tbody.ownerDocument.createElement("tr");
  row.className = "cm-md-table-virtual-spacer";
  row.setAttribute("aria-hidden", "true");
  const cell = context.tbody.ownerDocument.createElement("td");
  cell.colSpan = context.columnCount;
  cell.style.height = `${Math.max(1, height)}px`;
  row.appendChild(cell);
  return row;
}

function sameIndexes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
