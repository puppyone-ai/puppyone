import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  buildTabularProjectionItems,
  calculateFixedTabularWindow,
  calculateVelocityAwareTabularOverscan,
  calculateVariableTabularWindow,
  createTabularOffsets,
  type TabularDirectionalOverscan,
  type TabularProjectionItem,
  type TabularWindowRange,
} from "./tabularWindow";

const DEFAULT_ROW_SIZE = 31;
const DEFAULT_VIEWPORT_BLOCK_SIZE = 620;
const DEFAULT_VIEWPORT_INLINE_SIZE = 1_200;
const BASE_ROW_OVERSCAN = 4;
const MINIMUM_SCROLL_LEAD_ROWS = 10;
const MAXIMUM_SCROLL_LEAD_ROWS = 32;
const SCROLL_PREDICTION_HORIZON_MS = 32;
const SCROLL_END_DELAY_MS = 150;
const COLUMN_OVERSCAN_PX = 280;

export const TABULAR_VIEWPORT_MOUNTED_ROW_CAP = 80;
export const TABULAR_VIEWPORT_MOUNTED_CELL_CAP = 2_000;

type TabularViewportOptions = Readonly<{
  initialWindow?: Readonly<{ rowRange: TabularWindowRange; columnRange: TabularWindowRange }>;
  columnWidths: readonly number[];
  direction: "ltr" | "rtl";
  hasHeader: boolean;
  hasRowNumbers: boolean;
  pinnedColumnIndex?: number | null;
  pinnedDataRowIndex?: number | null;
  rowCount: number;
  scrollRef: RefObject<HTMLElement>;
  surfaceRef: RefObject<HTMLElement>;
}>;

type TabularViewportMetrics = {
  rowSize: number;
  surfaceBlockOffset: number;
  surfaceInlineOffset: number;
};

export type TabularViewportProjection = Readonly<{
  columnItems: readonly TabularProjectionItem[];
  columnRange: TabularWindowRange;
  handleScroll: () => void;
  mountedCellCount: number;
  mountedColumnCount: number;
  mountedRowCount: number;
  revealCell: (dataRowIndex: number, columnIndex: number) => void;
  rowItems: readonly TabularProjectionItem[];
  rowRange: TabularWindowRange;
}>;

export function useTabularViewport({
  initialWindow,
  columnWidths,
  direction,
  hasHeader,
  hasRowNumbers,
  pinnedColumnIndex = null,
  pinnedDataRowIndex = null,
  rowCount,
  scrollRef,
  surfaceRef,
}: TabularViewportOptions): TabularViewportProjection {
  const columnOffsets = useMemo(() => createTabularOffsets(columnWidths), [columnWidths]);
  const maximumWindowRows = Math.max(
    1,
    TABULAR_VIEWPORT_MOUNTED_ROW_CAP - (hasHeader ? 1 : 0) - 1,
  );
  const retainedWindow = initialWindow
    && initialWindow.rowRange.start >= 0 && initialWindow.rowRange.end <= rowCount
    && initialWindow.rowRange.end > initialWindow.rowRange.start
    && initialWindow.columnRange.start >= 0 && initialWindow.columnRange.end <= columnWidths.length
    && initialWindow.columnRange.end > initialWindow.columnRange.start
    && initialWindow.rowRange.end - initialWindow.rowRange.start <= maximumWindowRows
    && (initialWindow.rowRange.end - initialWindow.rowRange.start + 1)
      * (initialWindow.columnRange.end - initialWindow.columnRange.start + 1) <= TABULAR_VIEWPORT_MOUNTED_CELL_CAP
    ? initialWindow : undefined;
  // The first layout effect measures the real host before paint. Mount only a
  // geometry probe initially, rather than a guessed full viewport that is
  // immediately restyled/replaced. Returning views use their bounded window.
  const initialRowRange = retainedWindow?.rowRange ?? { start: 0, end: Math.min(1, rowCount) };
  const initialRowEnd = initialRowRange.end;
  const [rowRange, setRowRange] = useState<TabularWindowRange>(() => ({
    start: initialRowRange.start,
    end: initialRowEnd,
  }));
  const [columnRange, setColumnRange] = useState<TabularWindowRange>(() => (
    retainedWindow?.columnRange ?? { start: 0, end: Math.min(1, columnWidths.length) }
  ));
  const rowRangeRef = useRef(rowRange);
  const columnRangeRef = useRef(columnRange);
  const metricsRef = useRef<TabularViewportMetrics>({
    rowSize: DEFAULT_ROW_SIZE,
    surfaceBlockOffset: 0,
    surfaceInlineOffset: 0,
  });
  const frameRef = useRef<number | null>(null);
  const rowOverscanRef = useRef<TabularDirectionalOverscan>({
    afterItems: BASE_ROW_OVERSCAN,
    beforeItems: BASE_ROW_OVERSCAN,
  });
  const scrollSampleRef = useRef<{ offset: number; timestamp: number } | null>(null);
  const scrollEndTimerRef = useRef<number | null>(null);

  rowRangeRef.current = rowRange;
  columnRangeRef.current = columnRange;

  const updateWindow = useCallback((rowOverscan = rowOverscanRef.current) => {
    const scroll = scrollRef.current;
    const metrics = metricsRef.current;
    const viewportBlockSize = scroll?.clientHeight || DEFAULT_VIEWPORT_BLOCK_SIZE;
    const viewportInlineSize = scroll?.clientWidth || DEFAULT_VIEWPORT_INLINE_SIZE;
    const logicalScrollLeft = scroll
      ? direction === "rtl" ? Math.abs(scroll.scrollLeft) : Math.max(0, scroll.scrollLeft)
      : 0;
    const headerSize = hasHeader ? metrics.rowSize : 0;
    const rowScrollOffset = Math.max(
      0,
      (scroll?.scrollTop ?? 0) - metrics.surfaceBlockOffset - headerSize,
    );
    const nextRowRange = calculateFixedTabularWindow({
      count: rowCount,
      itemSize: metrics.rowSize,
      maximumItems: maximumWindowRows,
      overscanAfterItems: rowOverscan.afterItems,
      overscanBeforeItems: rowOverscan.beforeItems,
      overscanItems: BASE_ROW_OVERSCAN,
      scrollOffset: rowScrollOffset,
      viewportSize: Math.max(metrics.rowSize, viewportBlockSize - headerSize),
    });
    const pinnedRowOutsideWindow = pinnedDataRowIndex != null
      && (pinnedDataRowIndex < nextRowRange.start || pinnedDataRowIndex >= nextRowRange.end);
    const projectedRowCount = Math.max(
      1,
      nextRowRange.end - nextRowRange.start
        + (hasHeader ? 1 : 0)
        + (pinnedRowOutsideWindow ? 1 : 0),
    );
    const maximumWindowColumns = Math.max(
      1,
      Math.floor(TABULAR_VIEWPORT_MOUNTED_CELL_CAP / projectedRowCount) - 1,
    );
    const recordGutterSize = hasRowNumbers ? metrics.rowSize : 0;
    const columnScrollOffset = Math.max(
      0,
      logicalScrollLeft - metrics.surfaceInlineOffset - recordGutterSize,
    );
    const nextColumnRange = calculateVariableTabularWindow({
      offsets: columnOffsets,
      maximumItems: maximumWindowColumns,
      overscanSize: COLUMN_OVERSCAN_PX,
      scrollOffset: columnScrollOffset,
      viewportSize: Math.max(1, viewportInlineSize - recordGutterSize),
    });

    if (!sameRange(rowRangeRef.current, nextRowRange)) {
      rowRangeRef.current = nextRowRange;
      setRowRange(nextRowRange);
    }
    if (!sameRange(columnRangeRef.current, nextColumnRange)) {
      columnRangeRef.current = nextColumnRange;
      setColumnRange(nextColumnRange);
    }
  }, [
    columnOffsets,
    direction,
    hasHeader,
    hasRowNumbers,
    maximumWindowRows,
    pinnedDataRowIndex,
    rowCount,
    scrollRef,
  ]);

  const scheduleWindowUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestFrame(() => {
      frameRef.current = null;
      updateWindow();
    });
  }, [updateWindow]);

  const handleScroll = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      updateWindow();
      return;
    }
    const timestamp = now();
    const offset = scroll.scrollTop;
    const previous = scrollSampleRef.current;
    const deltaOffset = previous ? offset - previous.offset : 0;
    // Browsers may deliver more than one scroll event for the same position.
    // Keep the active directional lead until the scroll-end timer contracts it;
    // otherwise a duplicate event can discard the buffer before the next paint.
    const rowOverscan = previous && deltaOffset === 0
      ? rowOverscanRef.current
      : calculateVelocityAwareTabularOverscan({
        baseItems: BASE_ROW_OVERSCAN,
        deltaOffset,
        elapsedMs: previous ? timestamp - previous.timestamp : 16,
        itemSize: metricsRef.current.rowSize,
        maximumLeadItems: MAXIMUM_SCROLL_LEAD_ROWS,
        minimumLeadItems: MINIMUM_SCROLL_LEAD_ROWS,
        predictionHorizonMs: SCROLL_PREDICTION_HORIZON_MS,
      });
    scrollSampleRef.current = { offset, timestamp };
    rowOverscanRef.current = rowOverscan;
    // Scroll math is sub-millisecond and must run in the native event task so
    // React can commit before paint. Resize work remains frame-coalesced.
    updateWindow(rowOverscan);

    if (scrollEndTimerRef.current !== null) {
      window.clearTimeout(scrollEndTimerRef.current);
    }
    scrollEndTimerRef.current = window.setTimeout(() => {
      scrollEndTimerRef.current = null;
      scrollSampleRef.current = {
        offset: scroll.scrollTop,
        timestamp: now(),
      };
      const restingOverscan = {
        afterItems: BASE_ROW_OVERSCAN,
        beforeItems: BASE_ROW_OVERSCAN,
      };
      rowOverscanRef.current = restingOverscan;
      updateWindow(restingOverscan);
    }, SCROLL_END_DELAY_MS);
  }, [scrollRef, updateWindow]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const surface = surfaceRef.current;
    if (!scroll || !surface) {
      updateWindow();
      return undefined;
    }

    const measure = () => {
      const computed = getComputedStyle(surface);
      const measuredRowSize = Number.parseFloat(
        computed.getPropertyValue("--po-editable-table-row-min-height"),
      );
      metricsRef.current = {
        rowSize: measuredRowSize > 0 ? measuredRowSize : DEFAULT_ROW_SIZE,
        surfaceBlockOffset: surface.offsetTop,
        surfaceInlineOffset: surface.offsetLeft,
      };
      scrollSampleRef.current = {
        offset: scroll.scrollTop,
        timestamp: now(),
      };
      updateWindow();
    };

    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleWindowUpdate);
    observer?.observe(scroll);
    observer?.observe(surface);
    return () => observer?.disconnect();
  }, [scrollRef, scheduleWindowUpdate, surfaceRef, updateWindow]);

  useLayoutEffect(() => {
    updateWindow();
  }, [columnOffsets, hasHeader, hasRowNumbers, rowCount, updateWindow]);

  useLayoutEffect(() => () => {
    if (frameRef.current !== null) cancelFrame(frameRef.current);
    frameRef.current = null;
    if (scrollEndTimerRef.current !== null) window.clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = null;
  }, []);

  const revealCell = useCallback((dataRowIndex: number, columnIndex: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const metrics = metricsRef.current;
    const safeDataRowIndex = clampInteger(dataRowIndex, 0, Math.max(0, rowCount - 1));
    const safeColumnIndex = clampInteger(
      columnIndex,
      0,
      Math.max(0, columnWidths.length - 1),
    );
    const headerSize = hasHeader ? metrics.rowSize : 0;
    const rowTop = metrics.surfaceBlockOffset + headerSize + safeDataRowIndex * metrics.rowSize;
    const rowBottom = rowTop + metrics.rowSize;
    const visibleTop = scroll.scrollTop + headerSize;
    const visibleBottom = scroll.scrollTop + (scroll.clientHeight || DEFAULT_VIEWPORT_BLOCK_SIZE);
    if (rowTop < visibleTop) scroll.scrollTop = Math.max(0, rowTop - headerSize);
    else if (rowBottom > visibleBottom) scroll.scrollTop = rowBottom - (scroll.clientHeight || DEFAULT_VIEWPORT_BLOCK_SIZE);

    const recordGutterSize = hasRowNumbers ? metrics.rowSize : 0;
    const viewportInlineSize = Math.max(
      1,
      (scroll.clientWidth || DEFAULT_VIEWPORT_INLINE_SIZE) - recordGutterSize,
    );
    const logicalScrollLeft = direction === "rtl"
      ? Math.abs(scroll.scrollLeft)
      : Math.max(0, scroll.scrollLeft);
    const currentColumnOffset = Math.max(
      0,
      logicalScrollLeft - metrics.surfaceInlineOffset - recordGutterSize,
    );
    const columnStart = columnOffsets[safeColumnIndex] ?? 0;
    const columnEnd = columnOffsets[safeColumnIndex + 1] ?? columnStart;
    let nextColumnOffset = currentColumnOffset;
    if (columnStart < currentColumnOffset) nextColumnOffset = columnStart;
    else if (columnEnd > currentColumnOffset + viewportInlineSize) {
      nextColumnOffset = columnEnd - viewportInlineSize;
    }
    if (nextColumnOffset !== currentColumnOffset) {
      const nextLogicalScroll = metrics.surfaceInlineOffset + recordGutterSize + nextColumnOffset;
      scroll.scrollLeft = direction === "rtl" ? -nextLogicalScroll : nextLogicalScroll;
    }
    const restingOverscan = {
      afterItems: BASE_ROW_OVERSCAN,
      beforeItems: BASE_ROW_OVERSCAN,
    };
    rowOverscanRef.current = restingOverscan;
    scrollSampleRef.current = {
      offset: scroll.scrollTop,
      timestamp: now(),
    };
    updateWindow(restingOverscan);
  }, [
    columnOffsets,
    columnWidths.length,
    direction,
    hasHeader,
    hasRowNumbers,
    rowCount,
    scrollRef,
    updateWindow,
  ]);

  const rowItems = useMemo(() => buildTabularProjectionItems(
    rowCount,
    rowRange,
    pinnedDataRowIndex == null ? [] : [pinnedDataRowIndex],
    (start, end) => (end - start) * metricsRef.current.rowSize,
  ), [pinnedDataRowIndex, rowCount, rowRange]);
  const columnItems = useMemo(() => buildTabularProjectionItems(
    columnWidths.length,
    columnRange,
    pinnedColumnIndex == null ? [] : [pinnedColumnIndex],
    (start, end) => (columnOffsets[end] ?? 0) - (columnOffsets[start] ?? 0),
  ), [columnOffsets, columnRange, columnWidths.length, pinnedColumnIndex]);
  const mountedRowCount = countProjectionItems(rowItems) + (hasHeader ? 1 : 0);
  const mountedColumnCount = countProjectionItems(columnItems);

  return {
    columnItems,
    columnRange,
    handleScroll,
    mountedCellCount: mountedRowCount * mountedColumnCount,
    mountedColumnCount,
    mountedRowCount,
    revealCell,
    rowItems,
    rowRange,
  };
}

function countProjectionItems(items: readonly TabularProjectionItem[]): number {
  return items.reduce((count, item) => count + (item.kind === "item" ? 1 : 0), 0);
}

function sameRange(left: TabularWindowRange, right: TabularWindowRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
