/**
 * Track bounds for Markdown table columns.
 *
 * Markdown tables are document content laid out against the reading column,
 * so they own their geometry instead of inheriting the CSV editor's
 * spreadsheet limits. The floor keeps a column clickable and legible; the
 * ceiling only bounds explicit resizing, since automatic layout is already
 * bounded by the reading column.
 */
export const EMBEDDED_TABLE_COLUMN_MIN_WIDTH = 48;
export const EMBEDDED_TABLE_COLUMN_MAX_WIDTH = 960;

export function clampEmbeddedTableColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return EMBEDDED_TABLE_COLUMN_MIN_WIDTH;
  return Math.max(
    EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
    Math.min(EMBEDDED_TABLE_COLUMN_MAX_WIDTH, Math.round(width)),
  );
}
