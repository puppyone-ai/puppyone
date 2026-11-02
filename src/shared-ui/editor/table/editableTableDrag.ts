export type EditableTableDropSegment = Readonly<{
  boundary: number;
  start: number;
  size: number;
}>;

/** Shared midpoint policy used by Markdown and CSV row/column dragging. */
export function getEditableTableDropBoundary(
  segments: readonly EditableTableDropSegment[],
  pointer: number,
): number | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (pointer < segment.start + segment.size / 2) return segment.boundary;
  }
  return segments[segments.length - 1].boundary + 1;
}

export function getEditableTableColumnDropBoundary(
  cells: readonly HTMLTableCellElement[],
  pointer: number,
  direction: "ltr" | "rtl",
): number | null {
  if (cells.length === 0) return null;
  if (direction === "ltr") {
    return getEditableTableDropBoundary(cells.map((cell, boundary) => {
      const rect = cell.getBoundingClientRect();
      return { boundary, start: rect.left, size: rect.width };
    }), pointer);
  }

  for (const [boundary, cell] of cells.entries()) {
    const rect = cell.getBoundingClientRect();
    if (pointer > rect.left + rect.width / 2) return boundary;
  }
  return cells.length;
}
