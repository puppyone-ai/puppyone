export type DelimitedTextDelimiter = "," | "\t";

export type DelimitedTextLayout = Readonly<{
  lineEnding: "\n" | "\r\n" | "\r";
  trailingLineEnding: boolean;
  utf8Bom: boolean;
}>;

export type ParsedDelimitedText = Readonly<{
  rows: string[][];
  layout: DelimitedTextLayout;
  warning?: "unclosed-quote";
}>;

export type StringifyDelimitedTextOptions = Readonly<{
  /** Keep a final one-column empty record distinguishable from a line ending. */
  preserveTerminalEmptyRecord?: boolean;
}>;

/** Parse CSV/TSV source into the structured model owned by the contribution. */
export function parseDelimitedText(
  content: string,
  delimiter: DelimitedTextDelimiter,
): ParsedDelimitedText {
  const layout = detectLayout(content);
  const source = layout.utf8Bom ? content.slice(1) : content;
  if (!source) return { rows: [[""]], layout };

  const rows: string[][] = [[]];
  let current = "";
  let inQuotes = false;
  let warning: ParsedDelimitedText["warning"];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          current += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" && current.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      rows[rows.length - 1].push(current);
      current = "";
    } else if (char === "\n" || char === "\r") {
      rows[rows.length - 1].push(current);
      current = "";
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      rows.push([]);
    } else {
      current += char;
    }
  }

  rows[rows.length - 1].push(current);

  if (inQuotes) warning = "unclosed-quote";
  if (layout.trailingLineEnding) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0] === "") rows.pop();
  }

  return { rows: rows.length > 0 ? rows : [[""]], layout, warning };
}

/** Serialize the complete structured model into the canonical file snapshot. */
export function stringifyDelimitedText(
  rows: readonly (readonly string[])[],
  delimiter: DelimitedTextDelimiter,
  layout: DelimitedTextLayout = DEFAULT_LAYOUT,
  options: StringifyDelimitedTextOptions = {},
): string {
  const body = rows
    .map((row, rowIndex) => {
      const terminalEmptyRecord = options.preserveTerminalEmptyRecord
        && rowIndex === rows.length - 1
        && row.length === 1
        && row[0] === "";
      if (terminalEmptyRecord) return '""';
      return row.map((cell) => serializeCell(cell, delimiter)).join(delimiter);
    })
    .join(layout.lineEnding);
  return `${layout.utf8Bom ? "\uFEFF" : ""}${body}${layout.trailingLineEnding ? layout.lineEnding : ""}`;
}

export function inferDelimiter(
  name: string,
  content: string,
): DelimitedTextDelimiter {
  if (name.toLowerCase().endsWith(".tsv")) return "\t";
  const sample = content.split(/\r?\n/).slice(0, 8).join("\n");
  const tabCount = (sample.match(/\t/g) ?? []).length;
  const commaCount = (sample.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

export function inferHeaderRow(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const firstRow = rows[0] ?? [];
  if (firstRow.length === 0 || firstRow.every((cell) => !cell.trim())) return false;
  const normalizedLabels = firstRow.map((cell) => cell.trim().toLocaleLowerCase());
  const labelsAreHighConfidence = normalizedLabels.every((label) => (
    label.length > 0
    && label.length <= 64
    && !label.includes("\n")
    && !looksStructuredDataValue(label)
  ));
  if (!labelsAreHighConfidence || new Set(normalizedLabels).size !== normalizedLabels.length) return false;

  const sampleRows = rows.slice(1, 9);
  const isBlankStarterGrid = sampleRows.length >= 2
    && sampleRows.every((row) => row.every((cell) => !cell.trim()));
  if (isBlankStarterGrid) return true;

  return firstRow.some((_, columnIndex) => {
    const values = sampleRows
      .map((row) => row[columnIndex]?.trim() ?? "")
      .filter(Boolean);
    if (values.length === 0) return false;
    const structuredValues = values.filter(looksStructuredDataValue).length;
    return structuredValues >= Math.max(1, Math.ceil(values.length * 0.6));
  });
}

export function normalizeRows(rows: string[][]): string[][] {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return ensureShape(rows, Math.max(rows.length, 1), columnCount);
}

export function ensureShape(
  rows: string[][],
  rowCount: number,
  columnCount: number,
): string[][] {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const sourceRow = rows[rowIndex] ?? [];
    return Array.from({ length: columnCount }, (_, columnIndex) => sourceRow[columnIndex] ?? "");
  });
}

export function trimRows(rows: string[][]): string[][] {
  let lastRowIndex = rows.length - 1;
  while (lastRowIndex > 0 && rows[lastRowIndex].every((cell) => cell === "")) {
    lastRowIndex -= 1;
  }

  const slicedRows = rows.slice(0, lastRowIndex + 1);
  let lastColumnIndex = Math.max(0, ...slicedRows.map((row) => row.length - 1));
  while (lastColumnIndex > 0 && slicedRows.every((row) => (row[lastColumnIndex] ?? "") === "")) {
    lastColumnIndex -= 1;
  }

  return slicedRows.map((row) => row.slice(0, lastColumnIndex + 1));
}

export function toColumnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function serializeCell(value: string, delimiter: DelimitedTextDelimiter): string {
  const mustQuote = value.includes(delimiter)
    || value.includes("\"")
    || value.includes("\n")
    || value.includes("\r")
    || value !== value.trim();
  return mustQuote ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

const DEFAULT_LAYOUT: DelimitedTextLayout = Object.freeze({
  lineEnding: "\n",
  trailingLineEnding: false,
  utf8Bom: false,
});

function detectLayout(content: string): DelimitedTextLayout {
  const lineEnding = content.match(/\r\n|\n|\r/)?.[0] as DelimitedTextLayout["lineEnding"] | undefined;
  return {
    lineEnding: lineEnding ?? "\n",
    trailingLineEnding: /(?:\r\n|\n|\r)$/.test(content),
    utf8Bom: content.startsWith("\uFEFF"),
  };
}

function looksNumeric(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && Number.isFinite(Number(trimmed));
}

function looksStructuredDataValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return looksNumeric(trimmed)
    || /^(?:true|false|null)$/i.test(trimmed)
    || /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    || /^(?:https?:\/\/|www\.)\S+$/i.test(trimmed);
}
