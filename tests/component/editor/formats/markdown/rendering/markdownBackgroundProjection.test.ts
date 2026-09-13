/** @vitest-environment happy-dom */
import { forceParsing, syntaxTree } from "@codemirror/language";
import { EditorState, RangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewDecorations, requestMarkdownProjectionRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import { getMarkdownDecorationDiagnostics, resetMarkdownDecorationDiagnostics } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/blockDecorations";

it("reconciles actual background parse progress without scanning the unparsed document and matches a full projection", () => {
  const source = Array.from({ length: 10_000 }, (_, index) => `Paragraph ${index} with **bold** and [link](target.md).\n`).join("\n");
  const view = new EditorView({ parent: document.body, state: EditorState.create({
    doc: source, extensions: [markdownCodeMirrorBaseExtensions(false), markdownLivePreviewExtension()],
  }) });
  try {
    const initialLength = syntaxTree(view.state).length;
    expect(initialLength).toBeLessThan(source.length / 2);
    resetMarkdownDecorationDiagnostics();
    expect(forceParsing(view, initialLength + 2_000, 1_000)).toBe(true);
    expect(syntaxTree(view.state).length).toBeGreaterThan(initialLength);
    expect(getMarkdownDecorationDiagnostics().fullDocumentScans).toBe(0);
    expect(getMarkdownDecorationDiagnostics().linesScanned).toBeLessThan(1_000);
    const incremental = view.state.field(markdownLivePreviewDecorations);
    view.dispatch({ effects: requestMarkdownProjectionRange(view.state, 0, source.length) });
    const full = view.state.field(markdownLivePreviewDecorations);
    expect(RangeSet.eq([incremental.decorations], [full.decorations])).toBe(true);
    expect(RangeSet.eq([incremental.atomicRanges], [full.atomicRanges])).toBe(true);
  } finally { view.destroy(); document.body.replaceChildren(); }
});
