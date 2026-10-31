export type TabularWindowRange = Readonly<{
  start: number;
  end: number;
}>;

export type TabularDirectionalOverscan = Readonly<{
  afterItems: number;
  beforeItems: number;
}>;

export type TabularProjectionItem =
  | Readonly<{ kind: "item"; index: number }>
  | Readonly<{ kind: "gap"; start: number; end: number; size: number }>;

export function calculateFixedTabularWindow(options: Readonly<{
  count: number;
  itemSize: number;
  maximumItems: number;
  overscanAfterItems?: number;
  overscanBeforeItems?: number;
  overscanItems: number;
  scrollOffset: number;
  viewportSize: number;
}>): TabularWindowRange {
  const count = toNonNegativeInteger(options.count);
  if (count === 0) return { start: 0, end: 0 };
  const maximumItems = clampInteger(options.maximumItems, 1, count);

  const itemSize = positiveFinite(options.itemSize, 1);
  const viewportSize = positiveFinite(options.viewportSize, itemSize);
  const scrollOffset = Math.max(0, finite(options.scrollOffset, 0));
  const overscan = toNonNegativeInteger(options.overscanItems);
  const overscanBefore = options.overscanBeforeItems == null
    ? overscan
    : toNonNegativeInteger(options.overscanBeforeItems);
  const overscanAfter = options.overscanAfterItems == null
    ? overscan
    : toNonNegativeInteger(options.overscanAfterItems);
  const visibleStart = clampInteger(Math.floor(scrollOffset / itemSize), 0, count - 1);
  const visibleEnd = clampInteger(
    Math.ceil((scrollOffset + viewportSize) / itemSize),
    visibleStart + 1,
    count,
  );
  let start = Math.max(0, visibleStart - overscanBefore);
  let end = Math.min(count, visibleEnd + overscanAfter);

  if (end - start > maximumItems) {
    const visibleLength = visibleEnd - visibleStart;
    if (visibleLength >= maximumItems) {
      start = visibleStart;
      end = Math.min(count, start + maximumItems);
    } else {
      const remaining = maximumItems - visibleLength;
      const desiredBefore = visibleStart - start;
      const desiredAfter = end - visibleEnd;
      const desiredTotal = desiredBefore + desiredAfter;
      let allocatedBefore = desiredTotal > 0
        ? Math.min(desiredBefore, Math.floor(remaining * desiredBefore / desiredTotal))
        : 0;
      let allocatedAfter = Math.min(desiredAfter, remaining - allocatedBefore);
      const unallocated = remaining - allocatedBefore - allocatedAfter;
      if (unallocated > 0) {
        const beforeRoom = desiredBefore - allocatedBefore;
        const extraBefore = Math.min(beforeRoom, unallocated);
        allocatedBefore += extraBefore;
        allocatedAfter += Math.min(
          desiredAfter - allocatedAfter,
          unallocated - extraBefore,
        );
      }
      start = visibleStart - allocatedBefore;
      end = visibleEnd + allocatedAfter;
    }
  }

  return { start, end };
}

/**
 * Predict enough rows in the direction of travel to cover the next two paint
 * intervals while retaining a small reverse buffer for direction changes.
 */
export function calculateVelocityAwareTabularOverscan(options: Readonly<{
  baseItems: number;
  deltaOffset: number;
  elapsedMs: number;
  itemSize: number;
  maximumLeadItems: number;
  minimumLeadItems: number;
  predictionHorizonMs: number;
}>): TabularDirectionalOverscan {
  const baseItems = toNonNegativeInteger(options.baseItems);
  if (options.deltaOffset === 0) {
    return { beforeItems: baseItems, afterItems: baseItems };
  }
  const itemSize = positiveFinite(options.itemSize, 1);
  const elapsedMs = Math.min(32, Math.max(4, positiveFinite(options.elapsedMs, 16)));
  const predictionHorizonMs = Math.max(
    elapsedMs,
    positiveFinite(options.predictionHorizonMs, elapsedMs),
  );
  const predictedItems = Math.ceil(
    Math.abs(options.deltaOffset) / elapsedMs * predictionHorizonMs / itemSize,
  );
  const minimumLeadItems = Math.max(baseItems, toNonNegativeInteger(options.minimumLeadItems));
  const maximumLeadItems = Math.max(
    minimumLeadItems,
    toNonNegativeInteger(options.maximumLeadItems),
  );
  const leadItems = clampInteger(
    minimumLeadItems + predictedItems,
    minimumLeadItems,
    maximumLeadItems,
  );
  return options.deltaOffset > 0
    ? { beforeItems: baseItems, afterItems: leadItems }
    : { beforeItems: leadItems, afterItems: baseItems };
}

export function calculateVariableTabularWindow(options: Readonly<{
  offsets: readonly number[];
  maximumItems: number;
  overscanSize: number;
  scrollOffset: number;
  viewportSize: number;
}>): TabularWindowRange {
  const count = Math.max(0, options.offsets.length - 1);
  if (count === 0) return { start: 0, end: 0 };
  const maximumItems = clampInteger(options.maximumItems, 1, count);

  const totalSize = positiveFinite(options.offsets[count], 1);
  const viewportSize = positiveFinite(options.viewportSize, 1);
  const scrollOffset = Math.max(0, Math.min(totalSize, finite(options.scrollOffset, 0)));
  const viewportEnd = Math.min(totalSize, scrollOffset + viewportSize);
  const overscanSize = Math.max(0, finite(options.overscanSize, 0));
  const overscanStart = Math.max(0, scrollOffset - overscanSize);
  const overscanEnd = Math.min(totalSize, viewportEnd + overscanSize);
  let start = findFirstIntersectingItem(options.offsets, overscanStart);
  let end = findFirstStartingAtOrAfter(options.offsets, overscanEnd);
  end = Math.max(start + 1, Math.min(count, end));

  if (end - start > maximumItems) {
    const visibleStart = findFirstIntersectingItem(options.offsets, scrollOffset);
    const visibleEnd = Math.max(
      visibleStart + 1,
      Math.min(count, findFirstStartingAtOrAfter(options.offsets, viewportEnd)),
    );
    const visibleLength = Math.min(maximumItems, visibleEnd - visibleStart);
    const remaining = maximumItems - visibleLength;
    start = Math.max(0, visibleStart - Math.floor(remaining / 2));
    end = Math.min(count, start + maximumItems);
    start = Math.max(0, end - maximumItems);
  }

  return { start, end };
}

export function buildTabularProjectionItems(
  count: number,
  range: TabularWindowRange,
  pinnedIndices: readonly number[],
  getGapSize: (start: number, end: number) => number,
): readonly TabularProjectionItem[] {
  const safeCount = toNonNegativeInteger(count);
  const indices = new Set<number>();
  for (
    let index = clampInteger(range.start, 0, safeCount);
    index < clampInteger(range.end, 0, safeCount);
    index += 1
  ) {
    indices.add(index);
  }
  for (const index of pinnedIndices) {
    if (Number.isInteger(index) && index >= 0 && index < safeCount) indices.add(index);
  }

  const ordered = [...indices].sort((left, right) => left - right);
  const items: TabularProjectionItem[] = [];
  let cursor = 0;
  for (const index of ordered) {
    if (index > cursor) {
      items.push({ kind: "gap", start: cursor, end: index, size: getGapSize(cursor, index) });
    }
    items.push({ kind: "item", index });
    cursor = index + 1;
  }
  if (cursor < safeCount) {
    items.push({ kind: "gap", start: cursor, end: safeCount, size: getGapSize(cursor, safeCount) });
  }
  return items;
}

export function createTabularOffsets(sizes: readonly number[]): readonly number[] {
  const offsets = [0];
  for (const size of sizes) {
    offsets.push(offsets[offsets.length - 1] + positiveFinite(size, 1));
  }
  return offsets;
}

function findFirstIntersectingItem(offsets: readonly number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle + 1] ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(Math.max(0, low), Math.max(0, count - 1));
}

function findFirstStartingAtOrAfter(offsets: readonly number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1);
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? 0) < offset) low = middle + 1;
    else high = middle;
  }
  return Math.min(count, Math.max(0, low));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(finite(value, minimum))));
}

function toNonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(finite(value, 0)));
}

function positiveFinite(value: number, fallback: number): number {
  const resolved = finite(value, fallback);
  return resolved > 0 ? resolved : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
