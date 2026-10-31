import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

export type VirtualSidebarWindowOptions = {
  rowCount: number;
  rowSize: number;
  rowSizes?: readonly number[];
  scrollRef: RefObject<HTMLElement | null>;
  activeIndex?: number | null;
  overscan?: number;
  maxMountedRows?: number;
  fallbackViewportHeight?: number;
};

export type VirtualSidebarWindow = {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  offsetTop: number;
  endOffset: number;
  onScroll: () => void;
};

export function useVirtualSidebarWindow({
  activeIndex = null,
  fallbackViewportHeight = 640,
  maxMountedRows = 120,
  overscan = 10,
  rowCount,
  rowSize,
  rowSizes,
  scrollRef,
}: VirtualSidebarWindowOptions): VirtualSidebarWindow {
  const [viewport, setViewport] = useState({ height: fallbackViewportHeight, scrollTop: 0 });
  const animationFrameRef = useRef<number | null>(null);

  const readViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const height = element.clientHeight || fallbackViewportHeight;
    const scrollTop = Math.max(0, element.scrollTop);
    setViewport((current) => (
      current.height === height && current.scrollTop === scrollTop
        ? current
        : { height, scrollTop }
    ));
  }, [fallbackViewportHeight, scrollRef]);

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

  const rowOffsets = useMemo(() => {
    if (!rowSizes) return null;
    const offsets = new Array<number>(rowCount + 1);
    offsets[0] = 0;
    for (let index = 0; index < rowCount; index += 1) {
      offsets[index + 1] = offsets[index]! + (rowSizes[index] ?? rowSize);
    }
    return offsets;
  }, [rowCount, rowSize, rowSizes]);

  const visibleWindow = useMemo(() => {
    if (rowOffsets) {
      const firstVisibleIndex = findFirstVisibleVariableRow(
        rowOffsets,
        rowCount,
        viewport.scrollTop,
      );
      const viewportBottom = viewport.scrollTop + viewport.height;
      let visibleEndIndex = firstVisibleIndex;
      while (
        visibleEndIndex < rowCount
        && rowOffsets[visibleEndIndex]! < viewportBottom
      ) {
        visibleEndIndex += 1;
      }
      if (visibleEndIndex === firstVisibleIndex && firstVisibleIndex < rowCount) {
        visibleEndIndex += 1;
      }

      let startIndex = Math.max(0, firstVisibleIndex - overscan);
      let endIndex = Math.min(rowCount, visibleEndIndex + overscan);
      if (endIndex - startIndex > maxMountedRows) {
        const visibleCount = visibleEndIndex - firstVisibleIndex;
        if (visibleCount >= maxMountedRows) {
          startIndex = firstVisibleIndex;
          endIndex = Math.min(rowCount, startIndex + maxMountedRows);
        } else {
          const spareRows = maxMountedRows - visibleCount;
          const rowsBefore = Math.min(firstVisibleIndex, Math.floor(spareRows / 2));
          startIndex = firstVisibleIndex - rowsBefore;
          endIndex = Math.min(rowCount, startIndex + maxMountedRows);
          startIndex = Math.max(0, endIndex - maxMountedRows);
        }
      }
      return { startIndex, endIndex };
    }

    const firstVisibleIndex = Math.floor(viewport.scrollTop / rowSize);
    const visibleCount = Math.max(1, Math.ceil(viewport.height / rowSize));
    const desiredCount = Math.min(maxMountedRows, visibleCount + overscan * 2);
    const startIndex = Math.max(
      0,
      Math.min(firstVisibleIndex - overscan, Math.max(0, rowCount - desiredCount)),
    );
    const endIndex = Math.min(rowCount, startIndex + desiredCount);
    return { startIndex, endIndex };
  }, [maxMountedRows, overscan, rowCount, rowOffsets, rowSize, viewport.height, viewport.scrollTop]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || activeIndex === null || activeIndex < 0 || activeIndex >= rowCount) return;
    const rowTop = rowOffsets?.[activeIndex] ?? activeIndex * rowSize;
    const rowBottom = rowOffsets?.[activeIndex + 1] ?? rowTop + rowSize;
    const viewportTop = element.scrollTop;
    const viewportBottom = viewportTop + (element.clientHeight || fallbackViewportHeight);
    if (rowTop < viewportTop) element.scrollTop = rowTop;
    else if (rowBottom > viewportBottom) {
      element.scrollTop = Math.max(0, rowBottom - (element.clientHeight || viewport.height));
    } else return;
    readViewport();
  }, [activeIndex, fallbackViewportHeight, readViewport, rowCount, rowOffsets, rowSize, scrollRef, viewport.height]);

  const totalHeight = rowOffsets?.[rowCount] ?? rowCount * rowSize;
  const offsetTop = rowOffsets?.[visibleWindow.startIndex]
    ?? visibleWindow.startIndex * rowSize;
  const endOffset = rowOffsets?.[visibleWindow.endIndex]
    ?? visibleWindow.endIndex * rowSize;

  return {
    ...visibleWindow,
    totalHeight,
    offsetTop,
    endOffset,
    onScroll,
  };
}

function findFirstVisibleVariableRow(
  offsets: readonly number[],
  rowCount: number,
  scrollTop: number,
) {
  let low = 0;
  let high = rowCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1]! <= scrollTop) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, rowCount - 1));
}
