const EDITABLE_TABLE_COLUMN_WIDTH_SAMPLE_ROWS = 128;

export const EDITABLE_TABLE_COLUMN_MIN_WIDTH = 96;
export const EDITABLE_TABLE_COLUMN_MAX_WIDTH = 280;
export const EDITABLE_TABLE_COLUMN_INITIAL_MAX_WIDTH = 220;
export const EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH = 560;

/**
 * Estimate stable table column widths without measuring rendered DOM nodes.
 * Sampling keeps the calculation bounded for large CSV and Markdown tables,
 * while the first/last rows and the space between them remain represented.
 */
export function estimateEditableTableColumnWidths<Row>(
  rows: readonly Row[],
  minimumColumnCount: number,
  getCells: (row: Row) => readonly string[],
): readonly number[] {
  const sampledRows = sampleTableRows(rows, EDITABLE_TABLE_COLUMN_WIDTH_SAMPLE_ROWS);
  const sampledCells = sampledRows.map(getCells);
  const columnCount = Math.max(
    1,
    minimumColumnCount,
    ...sampledCells.map((cells) => cells.length),
  );

  return Array.from(
    { length: columnCount },
    (_, columnIndex) => estimateSampledColumnWidth(sampledCells, columnIndex),
  );
}

/** Recompute one width after a cell transaction without scanning every column. */
export function estimateEditableTableColumnWidth<Row>(
  rows: readonly Row[],
  columnIndex: number,
  getCells: (row: Row) => readonly string[],
): number {
  const sampledCells = sampleTableRows(rows, EDITABLE_TABLE_COLUMN_WIDTH_SAMPLE_ROWS).map(getCells);
  return estimateSampledColumnWidth(sampledCells, columnIndex);
}

/**
 * Proportionally fit explicit tracks into a viewport without making any
 * column unreadable. This is an explicit View action: resize observers and
 * content edits must never call it implicitly.
 */
export function fitEditableTableColumnWidths(
  currentWidths: readonly number[],
  availableWidth: number,
  maximumWidth = EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
): readonly number[] {
  if (currentWidths.length === 0) return [];
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return currentWidths.map((width) => clampEditableTableColumnWidth(width, maximumWidth));
  }
  const targetWidth = Math.max(
    EDITABLE_TABLE_COLUMN_MIN_WIDTH * currentWidths.length,
    Math.min(maximumWidth * currentWidths.length, Math.floor(availableWidth)),
  );
  const widths = currentWidths.map((width) => clampEditableTableColumnWidth(width, maximumWidth));
  const unresolved = new Set(widths.map((_, index) => index));
  const result = Array(widths.length).fill(0) as number[];
  let remainingTarget = targetWidth;
  let remainingSource = widths.reduce((sum, width) => sum + width, 0);

  while (unresolved.size > 0) {
    let clampedAny = false;
    for (const index of [...unresolved]) {
      const proportional = remainingSource > 0
        ? widths[index] / remainingSource * remainingTarget
        : remainingTarget / unresolved.size;
      const clamped = proportional < EDITABLE_TABLE_COLUMN_MIN_WIDTH
        ? EDITABLE_TABLE_COLUMN_MIN_WIDTH
        : proportional > maximumWidth
          ? maximumWidth
          : null;
      if (clamped == null) continue;
      result[index] = clamped;
      remainingTarget -= clamped;
      remainingSource -= widths[index];
      unresolved.delete(index);
      clampedAny = true;
    }
    if (!clampedAny) break;
  }

  const unresolvedIndexes = [...unresolved];
  for (const index of unresolvedIndexes) {
    result[index] = remainingSource > 0
      ? widths[index] / remainingSource * remainingTarget
      : remainingTarget / unresolvedIndexes.length;
  }

  const rounded = result.map((width) => Math.floor(width));
  let roundingRemainder = targetWidth - rounded.reduce((sum, width) => sum + width, 0);
  const byFraction = result
    .map((width, index) => ({ fraction: width - Math.floor(width), index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of byFraction) {
    if (roundingRemainder <= 0) break;
    if (rounded[index] >= maximumWidth) continue;
    rounded[index] += 1;
    roundingRemainder -= 1;
  }
  return rounded;
}

export function clampEditableTableColumnWidth(
  width: number,
  maximumWidth = EDITABLE_TABLE_COLUMN_RESIZE_MAX_WIDTH,
): number {
  return Math.max(
    EDITABLE_TABLE_COLUMN_MIN_WIDTH,
    Math.min(maximumWidth, Math.round(width)),
  );
}

function sampleTableRows<Row>(rows: readonly Row[], maximum: number): readonly Row[] {
  if (rows.length <= maximum) return rows;
  const sampled: Row[] = [];
  const seen = new Set<number>();
  for (let sampleIndex = 0; sampleIndex < maximum; sampleIndex += 1) {
    const rowIndex = Math.round(sampleIndex * (rows.length - 1) / (maximum - 1));
    if (seen.has(rowIndex)) continue;
    seen.add(rowIndex);
    sampled.push(rows[rowIndex]);
  }
  return sampled;
}

function estimateMaxLineVisualUnits(text: string): number {
  let maximum = 0;
  let current = 0;
  for (const character of text) {
    if (character === "\n") {
      maximum = Math.max(maximum, current);
      current = 0;
    } else if (character === "\t") {
      current += 4;
    } else {
      current += character.codePointAt(0)! > 0xff ? 2 : 1;
    }
  }
  return Math.max(maximum, current);
}

function estimateSampledColumnWidth(
  sampledCells: readonly (readonly string[])[],
  columnIndex: number,
): number {
  let visualUnits = 0;
  for (const cells of sampledCells) {
    visualUnits = Math.max(
      visualUnits,
      estimateMaxLineVisualUnits(cells[columnIndex] ?? ""),
    );
  }
  return Math.max(
    EDITABLE_TABLE_COLUMN_MIN_WIDTH,
    Math.min(EDITABLE_TABLE_COLUMN_MAX_WIDTH, 28 + visualUnits * 7),
  );
}
