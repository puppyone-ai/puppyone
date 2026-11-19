import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { STANDARD_CONTROL_SIZE } from "../../core/controlGeometry";
import { useCssPixelCustomProperty } from "../../core/useCssPixelCustomProperty";

export const EXPLORER_VIRTUAL_ROW_GAP = 2;
export const EXPLORER_VIRTUAL_ROW_SIZE = STANDARD_CONTROL_SIZE + EXPLORER_VIRTUAL_ROW_GAP;
export const EXPLORER_VIRTUAL_OVERSCAN = 10;
export const EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS = 100;
const EXPLORER_VIRTUAL_FALLBACK_VIEWPORT_HEIGHT = 640;

export type ExplorerVirtualWindow = {
  startIndex: number;
  endIndex: number;
  rowSize: number;
  totalHeight: number;
  onScroll: () => void;
};

export function useExplorerVirtualWindow({
  rowCount,
  scrollRef,
  activeIndex,
}: {
  rowCount: number;
  scrollRef: RefObject<HTMLDivElement>;
  activeIndex: number | null;
}): ExplorerVirtualWindow {
  const rowHeight = useCssPixelCustomProperty(
    scrollRef,
    "--tree-row-height",
    STANDARD_CONTROL_SIZE,
  );
  const rowSize = rowHeight + EXPLORER_VIRTUAL_ROW_GAP;
  const [viewport, setViewport] = useState({
    height: EXPLORER_VIRTUAL_FALLBACK_VIEWPORT_HEIGHT,
    scrollTop: 0,
  });
  const animationFrameRef = useRef<number | null>(null);

  const readViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const height = element.clientHeight || EXPLORER_VIRTUAL_FALLBACK_VIEWPORT_HEIGHT;
    const scrollTop = Math.max(0, element.scrollTop);
    setViewport((current) => (
      current.height === height && current.scrollTop === scrollTop
        ? current
        : { height, scrollTop }
    ));
  }, [scrollRef]);

  const onScroll = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      readViewport();
    });
  }, [readViewport]);

  useLayoutEffect(() => {
    readViewport();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(readViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [readViewport, scrollRef]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const visibleWindow = useMemo(() => {
    const firstVisibleIndex = Math.floor(viewport.scrollTop / rowSize);
    const visibleCount = Math.max(1, Math.ceil(viewport.height / rowSize));
    const desiredCount = Math.min(
      EXPLORER_VIRTUAL_MAX_MOUNTED_ROWS,
      visibleCount + EXPLORER_VIRTUAL_OVERSCAN * 2,
    );
    const startIndex = Math.max(
      0,
      Math.min(
        firstVisibleIndex - EXPLORER_VIRTUAL_OVERSCAN,
        Math.max(0, rowCount - desiredCount),
      ),
    );
    const endIndex = Math.min(rowCount, startIndex + desiredCount);
    return { startIndex, endIndex };
  }, [rowCount, rowSize, viewport.height, viewport.scrollTop]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || activeIndex === null || activeIndex < 0 || activeIndex >= rowCount) return;

    const rowTop = activeIndex * rowSize;
    const rowBottom = rowTop + rowSize;
    // Honor the container's scroll-padding like native scrollIntoView does, so
    // a pinned header or footer never covers the revealed row.
    const padding = readScrollPaddingBlock(element);
    const viewportTop = element.scrollTop + padding.start;
    const viewportBottom = element.scrollTop
      + (element.clientHeight || EXPLORER_VIRTUAL_FALLBACK_VIEWPORT_HEIGHT)
      - padding.end;
    if (rowTop < viewportTop) element.scrollTop = Math.max(0, rowTop - padding.start);
    else if (rowBottom > viewportBottom) {
      element.scrollTop = Math.max(0, rowBottom - (element.clientHeight || viewport.height) + padding.end);
    } else return;
    readViewport();
  }, [activeIndex, readViewport, rowCount, rowSize, scrollRef, viewport.height]);

  return {
    ...visibleWindow,
    rowSize,
    totalHeight: rowCount * rowSize,
    onScroll,
  };
}

function readScrollPaddingBlock(element: HTMLElement) {
  if (typeof window === "undefined") return { start: 0, end: 0 };
  const style = window.getComputedStyle(element);
  return {
    start: parseScrollPadding(style.scrollPaddingBlockStart),
    end: parseScrollPadding(style.scrollPaddingBlockEnd),
  };
}

/** `auto` and unresolved values contribute no inset. */
function parseScrollPadding(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
