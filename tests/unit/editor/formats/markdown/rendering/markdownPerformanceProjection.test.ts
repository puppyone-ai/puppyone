import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import {
  getMarkdownProjectionDiagnostics,
  markdownLivePreviewDecorations,
  requestMarkdownProjectionRange,
  resetMarkdownProjectionDiagnostics,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import {
  getMarkdownDecorationDiagnostics,
  resetMarkdownDecorationDiagnostics,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/blockDecorations";
import {
  getMarkdownPlanIndexDiagnostics,
  resetMarkdownPlanIndexDiagnostics,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { markdownLivePreviewFocusEffect } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/livePreviewFocus";

describe("Markdown incremental document projection", () => {
  it("patches a 10,000-line single-character edit without a full scan or plan rebuild", () => {
    let state = createState(makeMarkdown(10_000));
    const line = state.doc.line(5_000);
    state = state.update({
      effects: requestMarkdownProjectionRange(state, line.from, line.to),
    }).state;

    resetMarkdownProjectionDiagnostics();
    resetMarkdownDecorationDiagnostics();
    resetMarkdownPlanIndexDiagnostics();
    state = state.update({
      changes: { from: line.from + 2, to: line.from + 3, insert: "x" },
    }).state;

    expect(state.field(markdownLivePreviewDecorations).decorations.size).toBeGreaterThan(0);
    expect(getMarkdownDecorationDiagnostics()).toMatchObject({ fullDocumentScans: 0 });
    expect(getMarkdownDecorationDiagnostics().linesScanned).toBeLessThanOrEqual(8);
    expect(getMarkdownPlanIndexDiagnostics().fullBuilds).toBe(0);
    expect(getMarkdownProjectionDiagnostics().mappedTransactions).toBeGreaterThanOrEqual(1);
  });

  it("toggles one task token in 10,000 lines without scanning the document", () => {
    let state = createState(makeTaskMarkdown(10_000));
    const line = state.doc.line(5_000);
    const checkboxFrom = line.from + 2;
    const checkboxTo = checkboxFrom + 3;
    state = state.update({
      selection: EditorSelection.cursor(line.to),
      effects: requestMarkdownProjectionRange(state, line.from, line.to),
    }).state;

    resetMarkdownProjectionDiagnostics();
    resetMarkdownDecorationDiagnostics();
    resetMarkdownPlanIndexDiagnostics();
    state = state.update({
      changes: { from: checkboxFrom, to: checkboxTo, insert: "[x]" },
    }).state;

    expect(state.sliceDoc(checkboxFrom, checkboxTo)).toBe("[x]");
    expect(getMarkdownDecorationDiagnostics()).toMatchObject({ fullDocumentScans: 0 });
    expect(getMarkdownDecorationDiagnostics().linesScanned).toBeLessThanOrEqual(8);
    expect(getMarkdownPlanIndexDiagnostics().fullBuilds).toBe(0);
    expect(getMarkdownProjectionDiagnostics()).toMatchObject({
      mappedTransactions: 1,
      changedRangePatches: 1,
      globalInvalidations: 0,
    });
  });

  it("rebuilds only the old/new reveal block when focus changes", () => {
    const source = makeMarkdown(10_000);
    let state = createState(source);
    const position = source.indexOf("bold") + 2;
    state = state.update({
      selection: EditorSelection.cursor(position),
      effects: requestMarkdownProjectionRange(state, position, position + 1),
    }).state;

    resetMarkdownDecorationDiagnostics();
    resetMarkdownProjectionDiagnostics();
    state = state.update({
      selection: EditorSelection.cursor(position),
      effects: markdownLivePreviewFocusEffect.of(true),
    }).state;

    expect(getMarkdownDecorationDiagnostics().fullDocumentScans).toBe(0);
    expect(getMarkdownDecorationDiagnostics().linesScanned).toBeLessThanOrEqual(6);
    expect(getMarkdownProjectionDiagnostics().focusRevealPatches).toBeGreaterThan(0);
  });

  it("keeps structural table decoration in CodeMirror layout after a local edit", () => {
    let state = createState([
      "# Table",
      "",
      "| Name | Value |",
      "| --- | ---: |",
      "| A | 1 |",
      "| B | 2 |",
      "",
      "Tail",
    ].join("\n"));
    const tableLine = state.doc.line(5);
    state = state.update({
      effects: requestMarkdownProjectionRange(state, tableLine.from, tableLine.to),
    }).state;
    state = state.update({
      changes: { from: tableLine.from + 2, to: tableLine.from + 3, insert: "C" },
    }).state;

    let blockReplacementCount = 0;
    state.field(markdownLivePreviewDecorations).decorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget) blockReplacementCount += 1;
    });
    expect(blockReplacementCount).toBeGreaterThan(0);
  });

  it("keeps the table atom mounted when an adjacent empty line becomes prose", () => {
    const tableSource = [
      "| Name | Value |",
      "| --- | ---: |",
      "| A | 1 |",
    ].join("\n");
    let state = createState(`${tableSource}\n`);

    state = state.update({
      changes: { from: state.doc.length, insert: "正文" },
      selection: EditorSelection.cursor(state.doc.length + 2),
      userEvent: "input.type",
    }).state;

    const widgetRanges: Array<{ from: number; to: number }> = [];
    state.field(markdownLivePreviewDecorations).decorations.between(
      0,
      state.doc.length,
      (from, to, value) => {
        if (value.spec.widget) widgetRanges.push({ from, to });
      },
    );
    expect(widgetRanges).toContainEqual({ from: 0, to: tableSource.length });
    expect(state.sliceDoc(tableSource.length)).toBe("\n正文");
  });
});

function createState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    extensions: [
      ...markdownCodeMirrorBaseExtensions(false),
      markdownLivePreviewExtension("safe", null, "performance.md"),
    ],
  });
}

function makeMarkdown(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => (
    index % 40 === 0
      ? `# Heading ${index}`
      : `Paragraph ${index} with **bold**, _emphasis_, and [link](note-${index % 30}.md).`
  )).join("\n");
}

function makeTaskMarkdown(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `- [ ] Task ${index}`).join("\n");
}
