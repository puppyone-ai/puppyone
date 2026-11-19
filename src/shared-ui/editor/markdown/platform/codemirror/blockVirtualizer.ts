const MIN_ITEM_SIZE_PX = 1;

export type MarkdownVirtualRange = Readonly<{
  startIndex: number;
  endIndex: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  indexes: readonly number[];
  totalSize: number;
}>;

/**
 * Variable-size prefix index for a single oversized block. It owns no DOM and
 * no document state; the mounted WidgetSession supplies measurements and a
 * visible range. Prefix sums and offset lookup stay O(log n).
 */
export class MarkdownBlockVirtualizer {
  private readonly sizes: Float64Array;
  private readonly tree: Float64Array;

  constructor(
    readonly count: number,
    estimateSize: (index: number) => number,
  ) {
    const normalizedCount = Math.max(0, Math.floor(count));
    this.count = normalizedCount;
    this.sizes = new Float64Array(normalizedCount);
    this.tree = new Float64Array(normalizedCount + 1);

    for (let index = 0; index < normalizedCount; index += 1) {
      const size = normalizeSize(estimateSize(index));
      this.sizes[index] = size;
      this.add(index, size);
    }
  }

  getTotalSize(): number {
    return this.prefix(this.count);
  }

  getSize(index: number): number {
    return index >= 0 && index < this.count ? this.sizes[index] : 0;
  }

  getOffset(index: number): number {
    return this.prefix(clampInteger(index, 0, this.count));
  }

  updateSize(index: number, nextSize: number): number {
    if (index < 0 || index >= this.count) return 0;
    const normalized = normalizeSize(nextSize);
    const previous = this.sizes[index];
    const delta = normalized - previous;
    if (Math.abs(delta) < 0.5) return 0;
    this.sizes[index] = normalized;
    this.add(index, delta);
    return delta;
  }

  getRange(
    viewportStart: number,
    viewportEnd: number,
    overscan: number,
    pinnedIndexes: readonly number[] = [],
  ): MarkdownVirtualRange {
    if (this.count === 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        visibleStartIndex: 0,
        visibleEndIndex: -1,
        indexes: [],
        totalSize: 0,
      };
    }

    const totalSize = this.getTotalSize();
    const normalizedStart = clampNumber(Math.min(viewportStart, viewportEnd), 0, totalSize);
    const normalizedEnd = clampNumber(Math.max(viewportStart, viewportEnd), normalizedStart, totalSize);
    const visibleStart = this.findIndexAtOffset(normalizedStart);
    const visibleEnd = this.findIndexAtOffset(Math.max(normalizedStart, normalizedEnd - 0.01));
    const normalizedOverscan = Math.max(0, Math.floor(overscan));
    const startIndex = Math.max(0, visibleStart - normalizedOverscan);
    const endIndex = Math.min(this.count - 1, visibleEnd + normalizedOverscan);
    const indexes = new Set<number>();
    for (let index = startIndex; index <= endIndex; index += 1) indexes.add(index);
    for (const index of pinnedIndexes) {
      if (index >= 0 && index < this.count) indexes.add(Math.floor(index));
    }

    return {
      startIndex,
      endIndex,
      visibleStartIndex: visibleStart,
      visibleEndIndex: visibleEnd,
      indexes: Array.from(indexes).sort((left, right) => left - right),
      totalSize,
    };
  }

  private findIndexAtOffset(offset: number): number {
    if (this.count === 0) return -1;
    const target = clampNumber(offset, 0, Math.max(0, this.getTotalSize() - Number.EPSILON));
    let index = 0;
    let accumulated = 0;
    let bit = highestPowerOfTwoAtMost(this.count);

    while (bit !== 0) {
      const next = index + bit;
      if (next <= this.count && accumulated + this.tree[next] <= target) {
        index = next;
        accumulated += this.tree[next];
      }
      bit >>= 1;
    }

    return Math.min(this.count - 1, index);
  }

  private prefix(endExclusive: number): number {
    let index = clampInteger(endExclusive, 0, this.count);
    let total = 0;
    while (index > 0) {
      total += this.tree[index];
      index -= index & -index;
    }
    return total;
  }

  private add(index: number, delta: number) {
    for (let treeIndex = index + 1; treeIndex <= this.count; treeIndex += treeIndex & -treeIndex) {
      this.tree[treeIndex] += delta;
    }
  }
}

function normalizeSize(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_ITEM_SIZE_PX, value) : MIN_ITEM_SIZE_PX;
}

function highestPowerOfTwoAtMost(value: number): number {
  if (value <= 0) return 0;
  return 2 ** Math.floor(Math.log2(value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
