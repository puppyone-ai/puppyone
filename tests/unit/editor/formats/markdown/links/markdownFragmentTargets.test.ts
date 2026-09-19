import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { getMarkdownFragmentPosition, markdownFragmentTargetsFacet } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownFragmentTargets";
import { markdownHeadingIndexField } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownHeadingIndex";
import { getCollapsedMarkerDeletionUnit, getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { getMarkdownInlineHtmlAnchors } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlAnchors";
import { getMarkdownInlineHtmlDiagnostics, resetMarkdownInlineHtmlDiagnostics } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlModel";
import { markdownCodeMirrorBaseExtensions } from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";

function createState(doc: string) {
  const state = EditorState.create({ doc, extensions: [
    ...markdownCodeMirrorBaseExtensions(false),
    markdownHeadingIndexField,
    markdownFragmentTargetsFacet.of(getMarkdownInlineHtmlAnchors),
  ] });
  ensureSyntaxTree(state, doc.length, 1000);
  return state.update({}).state;
}

describe("Markdown source fragment targets", () => {
  it.each(['<a id="target"></a>', '<a id=target></a>', '<span id="target">text</span>'])(
    "resolves controlled inline HTML ID in %s",
    (source) => expect(getMarkdownFragmentPosition(createState(`Before ${source}`), "#target")).toBe(7),
  );

  it.each([
    '`<a id="target"></a>`',
    '```html\n<a id="target"></a>\n```',
    '<!-- <a id="target"></a> -->',
    'Text \\<a id="target"></a>',
    '<a id=target><a>',
    '<a id=target href="javascript:alert(1)"></a>',
    '<a id="target other"></a>',
  ])("does not register literal, incomplete or unsupported HTML: %s", (source) => {
    expect(getMarkdownFragmentPosition(createState(source), "#target")).toBeNull();
  });

  it("decodes fragments once, preserves authored case, and chooses the first duplicate", () => {
    const state = createState('Before <a id="Tar&#103;et"></a>\n\n<a id="Target"></a>');
    expect(getMarkdownFragmentPosition(state, "#Tar%67et")).toBe(7);
    expect(getMarkdownFragmentPosition(state, "#target")).toBeNull();
    expect(getMarkdownFragmentPosition(state, "#%Target")).toBeNull();
  });

  it("prefers explicit IDs to heading slugs and retains heading fallback", () => {
    const source = '# target\n\n<a id="target"></a>\n\n# Other heading';
    const state = createState(source);
    expect(getMarkdownFragmentPosition(state, "#target")).toBe(source.indexOf("<a"));
    expect(getMarkdownFragmentPosition(state, "#other-heading")).toBe(source.indexOf("Other heading"));
  });

  it("keeps lookups pane-local and reuses them for selection-only transactions", () => {
    const state = createState('<a id="target"></a> body');
    const other = createState('Other <a id="target"></a> body');
    const anchors = getMarkdownInlineHtmlAnchors(state);
    resetMarkdownInlineHtmlDiagnostics();
    expect(getMarkdownInlineHtmlAnchors(state.update({ selection: { anchor: 3 } }).state)).toBe(anchors);
    expect(getMarkdownInlineHtmlDiagnostics().rangeScans).toBe(0);
    expect(getMarkdownFragmentPosition(other, "#target")).toBe(6);
    expect(getMarkdownFragmentPosition(state, "#target")).toBe(0);
  });

  it("maps reused HTML subtrees after a distant edit and rescans only changed blocks", () => {
    const source = Array.from({ length: 100 }, (_, index) => `Block ${index} <a id="anchor-${index}"></a>`).join("\n\n");
    const state = createState(source);
    expect(getMarkdownFragmentPosition(state, "#anchor-99")).toBe(source.lastIndexOf("<a"));
    resetMarkdownInlineHtmlDiagnostics();
    let next = state.update({ changes: { from: 0, insert: "Prefix " } }).state;
    ensureSyntaxTree(next, next.doc.length, 1000);
    next = next.update({}).state;
    expect(getMarkdownFragmentPosition(next, "#anchor-99")).toBe(source.lastIndexOf("<a") + 7);
    expect(getMarkdownInlineHtmlDiagnostics().containersScanned).toBeLessThan(10);
    expect(getMarkdownInlineHtmlDiagnostics().fullDocumentScans).toBe(0);
  });

  it("removes targets when Markdown context changes to a code fence", () => {
    const state = createState('<a id="target"></a>');
    expect(getMarkdownFragmentPosition(state, "#target")).toBe(0);
    const next = state.update({ changes: [
      { from: 0, insert: "```html\n" },
      { from: state.doc.length, insert: "\n```" },
    ] }).state;
    expect(getMarkdownFragmentPosition(next, "#target")).toBeNull();
  });

  it("treats an empty anchor as one hidden deletion unit", () => {
    const anchor = '<a id="target"></a>';
    const state = createState(`Before ${anchor} after`);
    const range = { from: 7, to: 7 + anchor.length };
    expect(getMarkdownPlanIndex(state).find(({ element }) => element.kind === "inlineHtml")?.plan).toMatchObject({
      presentation: "inlineMark",
      markerRanges: [range],
      capabilities: { deleteUnits: [range] },
    });
    expect(getCollapsedMarkerDeletionUnit(state, range.from, "forward")).toEqual(range);
    expect(getCollapsedMarkerDeletionUnit(state, range.to, "backward")).toEqual(range);
  });
});
