import { describe, expect, it } from "vitest";
import {
  ensureShape,
  inferDelimiter,
  inferHeaderRow,
  normalizeRows,
  parseDelimitedText,
  stringifyDelimitedText,
  toColumnLabel,
  trimRows,
} from "../../../../../packages/shared-ui/src/editor/viewers/csv/csvDocument";

describe("CSV document model", () => {
  it("parses quoted delimiters, escaped quotes, and multiline cells", () => {
    const source = 'name,notes\n"Ada, A.","said ""hello""\non two lines"';

    expect(parseDelimitedText(source, ",")).toEqual({
      rows: [
        ["name", "notes"],
        ["Ada, A.", 'said "hello"\non two lines'],
      ],
      layout: {
        lineEnding: "\n",
        trailingLineEnding: false,
        utf8Bom: false,
      },
    });
  });

  it("serializes a complete snapshot that reparses to the same cell model", () => {
    const rows = [
      ["plain", "comma,value", 'quote " value'],
      ["line\nbreak", " padded ", ""],
    ];
    const snapshot = stringifyDelimitedText(rows, ",");

    expect(snapshot).toBe('plain,"comma,value","quote "" value"\n"line\nbreak"," padded ",');
    expect(parseDelimitedText(snapshot, ",").rows).toEqual(rows);
  });

  it("keeps CSV and TSV delimiter policy in the format model", () => {
    expect(inferDelimiter("table.tsv", "a,b\tc,d")).toBe("\t");
    expect(inferDelimiter("table.csv", "a\tb\nc\td")).toBe("\t");
    expect(inferDelimiter("table.csv", "a,b\nc,d")).toBe(",");
  });

  it("reports malformed quoted source without discarding its cells", () => {
    expect(parseDelimitedText('a,"unfinished', ",")).toEqual({
      rows: [["a", "unfinished"]],
      layout: {
        lineEnding: "\n",
        trailingLineEnding: false,
        utf8Bom: false,
      },
      warning: "unclosed-quote",
    });
  });

  it("preserves source newline and BOM conventions when a table is edited", () => {
    const parsed = parseDelimitedText("\uFEFFa,b\r\nc,d\r\n", ",");

    expect(parsed.layout).toEqual({
      lineEnding: "\r\n",
      trailingLineEnding: true,
      utf8Bom: true,
    });
    expect(stringifyDelimitedText([["updated", "b"], ["c", "d"]], ",", parsed.layout))
      .toBe("\uFEFFupdated,b\r\nc,d\r\n");
  });

  it("can preserve a terminal one-column empty record for structural editing", () => {
    const snapshot = stringifyDelimitedText(
      [["value"], [""]],
      ",",
      undefined,
      { preserveTerminalEmptyRecord: true },
    );

    expect(snapshot).toBe('value\n""');
    expect(parseDelimitedText(snapshot, ",").rows).toEqual([["value"], [""]]);
  });

  it("owns table normalization, trimming, header inference, and column labels", () => {
    expect(normalizeRows([["a"], ["b", "c"]])).toEqual([["a", ""], ["b", "c"]]);
    expect(ensureShape([["a"]], 2, 2)).toEqual([["a", ""], ["", ""]]);
    expect(trimRows([["a", ""], ["", ""]])).toEqual([["a"]]);
    expect(inferHeaderRow([["Name", "Count"], ["Ada", "2"]])).toBe(true);
    expect(inferHeaderRow([["Name", "Email"], ["Ada", "ada@example.com"]])).toBe(true);
    expect(inferHeaderRow([
      ["Column 1", "Column 2", "Column 3"],
      ["", "", ""],
      ["", "", ""],
    ])).toBe(true);
    expect(inferHeaderRow([["Name", "City"], ["Ada", "London"]])).toBe(false);
    expect(inferHeaderRow([["Alice", "London"], ["Bob", "Paris"]])).toBe(false);
    expect(inferHeaderRow([["Alice", "London"], ["", ""]])).toBe(false);
    expect(inferHeaderRow([["Name", "Name"], ["Ada", "Lovelace"]])).toBe(false);
    expect(toColumnLabel(0)).toBe("A");
    expect(toColumnLabel(26)).toBe("AA");
  });
});
