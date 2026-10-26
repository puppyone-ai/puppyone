import {
  EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
  clampEmbeddedTableColumnWidth,
} from "../../platform/codemirror/embeddedTableColumnGeometry";
import type { MarkdownTableAlignment, MarkdownTableRow } from "./tableModel";

/**
 * Markdown table column layout: document tables, not spreadsheets.
 *
 * Like a browser's automatic table layout, every column has a preferred
 * minimum (its longest unbreakable word) and a natural width (its longest
 * line set on one line). A table whose natural widths fit the reading column
 * hugs its content; a wider one fills the reading column; one that cannot fit
 * even its minimums scrolls. When filling, short columns (labels such as
 * "部分做到" or "PASS") keep their whole natural width so they never wrap,
 * and the long columns share the rest in proportion to how much each would
 * still grow. The CSV editor keeps its own
 * spreadsheet rules (fixed caps per column) and is not consulted here.
 *
 * Widths are estimated from text, never measured from DOM, so a table gets
 * stable tracks before it paints and while a cell switches to source.
 */

export type MarkdownTableColumnContent = Readonly<{
  /** Longest unbreakable run, in ems of the table font. */
  minEm: number;
  /** Longest line set without wrapping, in ems of the table font. */
  maxEm: number;
}>;

export type MarkdownTableLayoutMetrics = Readonly<{
  /** Inline size the table may occupy: the reading column. */
  availableWidth: number;
  /** Table font size: px per em of the table font. */
  emPx: number;
  /** Horizontal padding plus rule of one cell, in px. */
  cellInset: number;
}>;

export const DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS: MarkdownTableLayoutMetrics = Object.freeze({
  availableWidth: 640,
  emPx: 13,
  cellInset: 21,
});

/** A single long word wraps rather than claim more than this share of the row. */
const PREFERRED_MINIMUM_SHARE = 0.3;
/** Columns this narrow are labels: kept on one line while long columns flex. */
const SHORT_COLUMN_MAX_WIDTH = 160;
const SHORT_COLUMN_MAX_SHARE = 0.22;
/** Bold header glyphs set slightly wider than body text. */
const HEADER_WIDTH_FACTOR = 1.05;
/**
 * Text estimates carry a little slack: a track sized to the exact advance of
 * "基本没做到" still wraps once subpixel layout rounds against it.
 */
const ESTIMATE_SLACK = 1.06;
/** The table's own outer rule, which the reading column must also hold. */
const TABLE_OUTER_RULE = 2;
const SAMPLE_ROWS = 128;

export function estimateMarkdownTableColumnWidths(
  alignments: readonly MarkdownTableAlignment[],
  rows: readonly MarkdownTableRow[],
  metrics: MarkdownTableLayoutMetrics = DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS,
): readonly number[] {
  return layoutMarkdownTableColumns(measureMarkdownTableColumns(rows, alignments.length), metrics);
}

/** Double-click auto-fit: one column at its natural width, within the reading column. */
export function estimateMarkdownTableColumnWidth(
  rows: readonly MarkdownTableRow[],
  columnIndex: number,
  metrics: MarkdownTableLayoutMetrics = DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS,
): number {
  const content = measureMarkdownTableColumns(rows, columnIndex + 1)[columnIndex];
  const natural = content ? content.maxEm * metrics.emPx * ESTIMATE_SLACK + metrics.cellInset : 0;
  return clampEmbeddedTableColumnWidth(
    Math.min(Math.ceil(natural), usableWidth(metrics.availableWidth)),
  );
}

export function measureMarkdownTableColumns(
  rows: readonly MarkdownTableRow[],
  columnCount: number,
): MarkdownTableColumnContent[] {
  const count = Math.max(1, columnCount);
  const minEm = Array<number>(count).fill(0);
  const maxEm = Array<number>(count).fill(0);
  for (const row of sampleRows(rows)) {
    const factor = row.header ? HEADER_WIDTH_FACTOR : 1;
    row.cells.forEach((cell, columnIndex) => {
      if (columnIndex >= count) return;
      const extent = measureCellText(cell.text);
      minEm[columnIndex] = Math.max(minEm[columnIndex], extent.minEm * factor);
      maxEm[columnIndex] = Math.max(maxEm[columnIndex], extent.maxEm * factor);
    });
  }
  return minEm.map((min, index) => ({ minEm: min, maxEm: Math.max(min, maxEm[index]) }));
}

export function layoutMarkdownTableColumns(
  contents: readonly MarkdownTableColumnContent[],
  metrics: MarkdownTableLayoutMetrics,
): number[] {
  if (contents.length === 0) return [];
  const available = usableWidth(metrics.availableWidth);
  const minimumCap = Math.max(EMBEDDED_TABLE_COLUMN_MIN_WIDTH, available * PREFERRED_MINIMUM_SHARE);
  const tracks = contents.map((content) => {
    const natural = Math.max(
      EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
      Math.ceil(content.maxEm * metrics.emPx * ESTIMATE_SLACK + metrics.cellInset),
    );
    const minimum = Math.min(natural, Math.max(
      EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
      Math.min(
        minimumCap,
        Math.ceil(content.minEm * metrics.emPx * ESTIMATE_SLACK + metrics.cellInset),
      ),
    ));
    return { minimum, natural };
  });
  const naturalTotal = sum(tracks.map((track) => track.natural));
  const minimumTotal = sum(tracks.map((track) => track.minimum));

  if (naturalTotal <= available) return tracks.map((track) => track.natural);

  const shortLimit = Math.min(SHORT_COLUMN_MAX_WIDTH, available * SHORT_COLUMN_MAX_SHARE);
  const isShort = tracks.map((track) => track.natural <= shortLimit);
  const shortTotal = sum(tracks.filter((_, index) => isShort[index]).map((track) => track.natural));
  const longTracks = tracks.filter((_, index) => !isShort[index]);
  const longMinimumTotal = sum(longTracks.map((track) => track.minimum));
  if (longTracks.length > 0 && shortTotal + longMinimumTotal <= available) {
    const flexible = available - shortTotal;
    const longNaturalTotal = sum(longTracks.map((track) => track.natural));
    const ratio = (flexible - longMinimumTotal) / (longNaturalTotal - longMinimumTotal);
    const exact = tracks.map((track, index) => isShort[index]
      ? track.natural
      : track.minimum + (track.natural - track.minimum) * ratio);
    return distributeRemainder(exact, available, isShort);
  }

  if (minimumTotal >= available) return tracks.map((track) => track.minimum);
  const ratio = (available - minimumTotal) / (naturalTotal - minimumTotal);
  const exact = tracks.map((track) => track.minimum + (track.natural - track.minimum) * ratio);
  return distributeRemainder(exact, available);
}

/** Explicit "fit to viewport": scale current tracks onto the reading column. */
export function fitMarkdownTableColumnWidths(
  currentWidths: readonly number[],
  availableWidth: number,
): number[] {
  if (currentWidths.length === 0) return [];
  const widths = currentWidths.map(clampEmbeddedTableColumnWidth);
  const target = Math.max(
    EMBEDDED_TABLE_COLUMN_MIN_WIDTH * widths.length,
    usableWidth(availableWidth),
  );
  const total = sum(widths);
  const exact = widths.map((width) => Math.max(
    EMBEDDED_TABLE_COLUMN_MIN_WIDTH,
    total > 0 ? width / total * target : target / widths.length,
  ));
  return distributeRemainder(exact, target);
}

function usableWidth(availableWidth: number): number {
  const width = Number.isFinite(availableWidth) && availableWidth > 0
    ? availableWidth
    : DEFAULT_MARKDOWN_TABLE_LAYOUT_METRICS.availableWidth;
  return Math.max(EMBEDDED_TABLE_COLUMN_MIN_WIDTH, Math.floor(width) - TABLE_OUTER_RULE);
}

function distributeRemainder(
  exact: readonly number[],
  target: number,
  fixed: readonly boolean[] = [],
): number[] {
  const rounded = exact.map((width) => Math.floor(width));
  let remainder = Math.round(target - sum(rounded));
  const byFraction = exact
    .map((width, index) => ({ fraction: width - Math.floor(width), index }))
    .filter(({ index }) => !fixed[index])
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    rounded[index] += 1;
    remainder -= 1;
  }
  return rounded;
}

function sampleRows(rows: readonly MarkdownTableRow[]): readonly MarkdownTableRow[] {
  if (rows.length <= SAMPLE_ROWS) return rows;
  const sampled: MarkdownTableRow[] = [];
  const seen = new Set<number>();
  for (let sample = 0; sample < SAMPLE_ROWS; sample += 1) {
    const index = Math.round(sample * (rows.length - 1) / (SAMPLE_ROWS - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    sampled.push(rows[index]);
  }
  return sampled;
}

type TextExtent = Readonly<{ minEm: number; maxEm: number }>;

/**
 * Visible extent of a cell's Markdown source: link targets, emphasis markers
 * and escapes are not painted; inline code is set in the monospace face.
 * Lines break at explicit breaks; words break at spaces, after `/` and `-`,
 * and around every wide (CJK) character, as browsers do.
 */
export function measureCellText(source: string): TextExtent {
  const text = source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
  let minEm = 0;
  let maxEm = 0;
  for (const line of text.split(/<br\s*\/?>|\n/i)) {
    let lineEm = 0;
    let wordEm = 0;
    let monospace = false;
    for (const character of line) {
      if (character === "`") {
        monospace = !monospace;
        continue;
      }
      const codePoint = character.codePointAt(0)!;
      const width = monospace && !isWide(codePoint) ? 0.6 : characterEm(character, codePoint);
      lineEm += width;
      if (character === " " || character === "\t") {
        minEm = Math.max(minEm, wordEm);
        wordEm = 0;
      } else if (isWide(codePoint)) {
        minEm = Math.max(minEm, wordEm, width);
        wordEm = 0;
      } else {
        wordEm += width;
        if (character === "/" || character === "-") {
          minEm = Math.max(minEm, wordEm);
          wordEm = 0;
        }
      }
    }
    minEm = Math.max(minEm, wordEm);
    maxEm = Math.max(maxEm, lineEm);
  }
  return { minEm, maxEm };
}

function characterEm(character: string, codePoint: number): number {
  if (isWide(codePoint)) return 1;
  if (character === " ") return 0.28;
  if (character === "\t") return 1.12;
  if (/[A-Z]/.test(character)) return /[MW]/.test(character) ? 0.86 : 0.64;
  if (/[0-9]/.test(character)) return 0.58;
  if (/[mw]/.test(character)) return 0.82;
  if (/[iljtfr.,:;'|!()[\]]/.test(character)) return 0.32;
  return 0.54;
}

function isWide(codePoint: number): boolean {
  return (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
