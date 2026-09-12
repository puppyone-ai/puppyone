import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  applyMarkdownTableOperation,
  getMarkdownTableBlock,
  getMarkdownTableSyntaxRange,
  isMarkdownTableLine,
  isMarkdownTableSourceLine,
  serializeMarkdownTable,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableModel";
import { markdownCodeMirrorLanguageExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

function createMarkdownState(source: string) {
  return EditorState.create({ doc: source });
}

function getTable(source: string) {
  const table = getMarkdownTableBlock(
    createMarkdownState(source),
    1,
    { from: 0, to: source.length },
  );
  expect(table).not.toBeNull();
  return table!;
}

describe("markdown table model", () => {
  it("keeps broad parser rows separate from conservative source-line styling", () => {
    expect(isMarkdownTableLine("a | b")).toBe(true);
    expect(isMarkdownTableSourceLine("a | b")).toBe(false);
    expect(isMarkdownTableSourceLine("| a |")).toBe(true);
  });

  it("parses alignments and escaped pipes without splitting cells", () => {
    const table = getTable([
      "| Name | Count | Notes |",
      "| :--- | ---: | :---: |",
      "| A\\|B | 3 | x |",
    ].join("\n"));

    expect(table.alignments).toEqual(["left", "right", "center"]);
    expect(table.rows[1].cells[0].text).toBe("A|B");
    expect(serializeMarkdownTable(table)).toBe([
      "| Name | Count | Notes |",
      "| :--- | ---:  | :---: |",
      "| A\\|B | 3     | x     |",
    ].join("\n"));
  });

  it("accepts a parser-owned one-hyphen delimiter and canonicalizes only on edit", () => {
    const source = [
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n");
    const table = getTable(source);

    expect(table.refinementValid).toBe(true);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(source).toContain("| - | - |");

    const result = applyMarkdownTableOperation(table, {
      type: "insert-row-below",
      rowIndex: 1,
      columnIndex: 0,
    });
    expect(result.replacement).toContain("| --- | --- |");
  });

  it("derives a one-hyphen table range from the real incremental parser", () => {
    const source = [
      "before",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "after",
    ].join("\n");
    const state = EditorState.create({
      doc: source,
      extensions: [markdownCodeMirrorLanguageExtension("openknowledge-mdx")],
    });
    const headerLineNumber = 3;
    const syntaxRange = getMarkdownTableSyntaxRange(state, headerLineNumber);
    const table = getMarkdownTableBlock(state, headerLineNumber);

    expect(syntaxRange).toEqual({
      from: source.indexOf("| A | B |"),
      to: source.indexOf("\n\nafter"),
    });
    expect(table).toMatchObject({
      from: syntaxRange?.from,
      to: syntaxRange?.to,
      refinementValid: true,
      rowCount: 2,
      modelComplete: true,
    });
    expect(state.sliceDoc(table?.to ?? 0)).toBe("\n\nafter");
  });

  it("keeps adjacent prose outside the interactive table range", () => {
    const source = [
      "| Slot | Desktop | Cloud |",
      "| --- | --- | --- |",
      "| Storage | local disk | S3 |",
      "这里面有几个要素值得注意。",
      "**第一，正文不能变成空表格行。**",
    ].join("\n");
    const state = EditorState.create({
      doc: source,
      extensions: [markdownCodeMirrorLanguageExtension("puppy-gfm")],
    });
    const syntaxRange = getMarkdownTableSyntaxRange(state, 1);
    const table = getMarkdownTableBlock(state, 1);
    const proseFrom = source.indexOf("\n这里面") + 1;

    // The GFM parser deliberately owns all non-blank lines in this leaf.
    expect(syntaxRange).toEqual({ from: 0, to: source.length });
    // The interactive table only owns rows with explicit pipe syntax.
    expect(table).toMatchObject({
      from: 0,
      to: proseFrom - 1,
      nextLineNumber: 4,
      rowCount: 2,
      modelComplete: true,
    });
    expect(table?.rows).toHaveLength(2);
    expect(state.sliceDoc(table?.to ?? 0)).toBe(source.slice(proseFrom - 1));
  });

  it("keeps an explicit unframed body row but stops before pipe-less prose", () => {
    const source = [
      "Name | Runtime | Storage",
      "--- | --- | ---",
      "Desktop | macOS | local disk",
      "Cloud native agents assemble context from many sources.",
    ].join("\n");
    const state = EditorState.create({
      doc: source,
      extensions: [markdownCodeMirrorLanguageExtension("puppy-gfm")],
    });
    const table = getMarkdownTableBlock(state, 1);

    expect(table?.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Name", "Runtime", "Storage"],
      ["Desktop", "macOS", "local disk"],
    ]);
    expect(table?.nextLineNumber).toBe(4);
    expect(state.sliceDoc(table?.to ?? 0)).toBe(
      "\nCloud native agents assemble context from many sources.",
    );
  });

  it("does not mistake escaped prose pipes for an editable table row", () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "ordinary prose with an escaped \\| character",
    ].join("\n");
    const state = EditorState.create({
      doc: source,
      extensions: [markdownCodeMirrorLanguageExtension("puppy-gfm")],
    });
    const table = getMarkdownTableBlock(state, 1);

    expect(table?.rows).toHaveLength(1);
    expect(table?.nextLineNumber).toBe(3);
    expect(state.sliceDoc(table?.to ?? 0)).toBe(
      "\nordinary prose with an escaped \\| character",
    );
  });

  it("refuses text-only table refinement without a parser-owned Table node", () => {
    const source = "| A | B |\n| - | - |\n| 1 | 2 |";
    const state = EditorState.create({ doc: source });

    expect(getMarkdownTableSyntaxRange(state, 1)).toBeNull();
    expect(getMarkdownTableBlock(state, 1)).toBeNull();
  });

  it("inserts rows through a whole-table padded rewrite", () => {
    const table = getTable([
      "| A | B |",
      "| --- | :---: |",
      "| 1 | 2 |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "insert-row-below",
      rowIndex: 1,
      columnIndex: 1,
    });

    expect(result.focus).toEqual({ rowIndex: 2, columnIndex: 0 });
    expect(result.replacement).toBe([
      "| A   | B     |",
      "| --- | :---: |",
      "| 1   | 2     |",
      "|     |       |",
    ].join("\n"));
  });

  it("deletes columns while preserving remaining alignment and escaped pipes", () => {
    const table = getTable([
      "| Name | Count | Notes |",
      "| :--- | ---: | :---: |",
      "| A\\|B | 3 | x |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "delete-column",
      rowIndex: 1,
      columnIndex: 1,
    });

    expect(result.focus).toEqual({ rowIndex: 1, columnIndex: 1 });
    expect(result.replacement).toBe([
      "| Name | Notes |",
      "| :--- | :---: |",
      "| A\\|B | x     |",
    ].join("\n"));
  });

  it("normalizes ragged rows before structural edits", () => {
    const table = getTable([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "insert-column-right",
      rowIndex: 1,
      columnIndex: 1,
    });

    expect(result.focus).toEqual({ rowIndex: 1, columnIndex: 2 });
    expect(result.replacement).toBe([
      "| A   | B   |     | C   |",
      "| --- | --- | --- | --- |",
      "| 1   | 2   |     |     |",
    ].join("\n"));
  });

  it("moves body rows without moving the header row", () => {
    const table = getTable([
      "| A |",
      "| --- |",
      "| one |",
      "| two |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "move-row-up",
      rowIndex: 2,
      columnIndex: 0,
    });

    expect(result.focus).toEqual({ rowIndex: 1, columnIndex: 0 });
    expect(result.replacement).toBe([
      "| A   |",
      "| --- |",
      "| two |",
      "| one |",
    ].join("\n"));
  });

  it("moves rows to an arbitrary target as one rewrite", () => {
    const table = getTable([
      "| A |",
      "| --- |",
      "| one |",
      "| two |",
      "| three |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "move-row-to",
      rowIndex: 1,
      columnIndex: 0,
      targetRowIndex: 3,
    });

    expect(result.focus).toEqual({ rowIndex: 3, columnIndex: 0 });
    expect(result.replacement).toBe([
      "| A     |",
      "| ---   |",
      "| two   |",
      "| three |",
      "| one   |",
    ].join("\n"));
  });

  it("moves columns to an arbitrary target with alignment", () => {
    const table = getTable([
      "| A | B | C |",
      "| :--- | :---: | ---: |",
      "| 1 | 2 | 3 |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "move-column-to",
      rowIndex: 0,
      columnIndex: 0,
      targetColumnIndex: 2,
    });

    expect(result.focus).toEqual({ rowIndex: 0, columnIndex: 2 });
    expect(result.replacement).toBe([
      "| B     | C    | A    |",
      "| :---: | ---: | :--- |",
      "| 2     | 3    | 1    |",
    ].join("\n"));
  });

  it("keeps single-column delete-column as a no-op", () => {
    const table = getTable([
      "| A |",
      "| --- |",
      "| one |",
    ].join("\n"));

    const result = applyMarkdownTableOperation(table, {
      type: "delete-column",
      rowIndex: 1,
      columnIndex: 0,
    });

    expect(result.focus).toEqual({ rowIndex: 1, columnIndex: 0 });
    expect(result.replacement).toBe([
      "| A   |",
      "| --- |",
      "| one |",
    ].join("\n"));
  });
});
