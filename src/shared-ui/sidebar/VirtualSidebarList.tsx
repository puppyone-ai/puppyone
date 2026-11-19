import { useCallback, useMemo, useRef, type CSSProperties, type Key, type MutableRefObject, type ReactNode } from "react";
import { joinSidebarClassNames } from "./classNames";
import { useVirtualSidebarWindow } from "./useVirtualSidebarWindow";

export type VirtualSidebarListProps<T> = {
  items: readonly T[];
  rowSize: number | ((item: T, index: number) => number);
  listRef?: MutableRefObject<HTMLOListElement | null>;
  renderRow: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => Key;
  activeIndex?: number | null;
  ariaLabel?: string;
  className?: string;
  maxMountedRows?: number;
  overscan?: number;
};

export function VirtualSidebarList<T>({
  activeIndex = null,
  ariaLabel,
  className,
  getKey,
  items,
  listRef,
  maxMountedRows,
  overscan,
  renderRow,
  rowSize,
}: VirtualSidebarListProps<T>) {
  const internalScrollRef = useRef<HTMLOListElement | null>(null);
  const setScrollElement = useCallback((element: HTMLOListElement | null) => {
    internalScrollRef.current = element;
    if (listRef) listRef.current = element;
  }, [listRef]);
  const resolvedRowSizes = useMemo(() => typeof rowSize === "function"
    ? items.map((item, index) => normalizeRowSize(rowSize(item, index)))
    : null, [items, rowSize]);
  const fallbackRowSize = typeof rowSize === "number"
    ? normalizeRowSize(rowSize)
    : (resolvedRowSizes?.[0] ?? 1);
  const windowState = useVirtualSidebarWindow({
    activeIndex,
    maxMountedRows,
    overscan,
    rowCount: items.length,
    rowSize: fallbackRowSize,
    rowSizes: resolvedRowSizes ?? undefined,
    scrollRef: internalScrollRef,
  });
  const visibleItems = items.slice(windowState.startIndex, windowState.endIndex);
  const leadingSpacerStyle = {
    "--po-sidebar-virtual-spacer-size": `${windowState.offsetTop}px`,
  } as CSSProperties;
  const trailingSpacerStyle = {
    "--po-sidebar-virtual-spacer-size": `${Math.max(
      0,
      windowState.totalHeight - windowState.endOffset,
    )}px`,
  } as CSSProperties;

  return (
    <ol
      ref={setScrollElement}
      className={joinSidebarClassNames("po-sidebar-virtual-scroll", className)}
      data-po-scrollbar="sidebar"
      aria-label={ariaLabel}
      onScroll={windowState.onScroll}
    >
      {windowState.offsetTop > 0 && (
        <li className="po-sidebar-virtual-spacer" style={leadingSpacerStyle} aria-hidden="true" />
      )}
      {visibleItems.map((item, visibleIndex) => {
        const index = windowState.startIndex + visibleIndex;
        const resolvedRowSize = resolvedRowSizes?.[index] ?? fallbackRowSize;
        const rowStyle = {
          "--po-sidebar-virtual-row-size": `${resolvedRowSize}px`,
        } as CSSProperties;
        return (
          <li className="po-sidebar-virtual-row" style={rowStyle} key={getKey(item, index)}>
            {renderRow(item, index)}
          </li>
        );
      })}
      {windowState.endIndex < items.length && (
        <li className="po-sidebar-virtual-spacer" style={trailingSpacerStyle} aria-hidden="true" />
      )}
    </ol>
  );
}

function normalizeRowSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
