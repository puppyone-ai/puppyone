import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  getBlockMarkerAtVisibleStart,
  getHiddenBlockMarkerCaretNormalization,
  getInlineFormatCoverage,
  getInlineFormatSelectionElement,
  getInlineRevealElement,
  getMarkdownElements,
  getMarkdownElementsInRange,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import { markdownHiddenMarkerSelectionNormalizer } from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/selectionBehavior";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { findMarkdownLinkTokens } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkModel";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
      markdownHiddenMarkerSelectionNormalizer,
    ],
  });
}

describe("markdown live preview element model", () => {
  it("normalizes heading marker ranges", () => {
    const state = createMarkdownState("# Heading");
    const heading = getMarkdownElements(state).find((element) => element.kind === "heading");

    expect(heading).toMatchObject({
      kind: "heading",
      from: 0,
      to: 9,
      markerRanges: [{ from: 0, to: 2 }],
      contentRange: { from: 2, to: 9 },
      level: 1,
    });
  });

  it("normalizes task marker stages", () => {
    const state = createMarkdownState("- [x] Done");
    const task = getMarkdownElements(state).find((element) => element.kind === "task");

    expect(task?.markerRanges).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 6 },
    ]);
    expect(task?.contentRange).toEqual({ from: 6, to: 10 });
  });

  it("normalizes wiki links and standard links", () => {
    const state = createMarkdownState("[label](note.md) and [[Target|Alias]]");
    const links = getMarkdownElements(state).filter((element) => element.kind === "link" || element.kind === "wikiLink");

    expect(links.map((element) => ({
      kind: element.kind,
      from: element.from,
      to: element.to,
      contentRange: element.contentRange,
    }))).toEqual([
      { kind: "link", from: 0, to: 16, contentRange: { from: 1, to: 6 } },
      { kind: "wikiLink", from: 21, to: 37, contentRange: { from: 30, to: 35 } },
    ]);
  });

  it("reveals inline elements only when the caret is strictly inside", () => {
    const state = createMarkdownState("A **bold** word");
    expect(getInlineRevealElement(state, 2)).toBeNull();
    expect(getInlineRevealElement(state, 3)?.kind).toBe("strong");
    expect(getInlineRevealElement(state, 8)?.kind).toBe("strong");
    expect(getInlineRevealElement(state, 10)).toBeNull();
  });

  it("treats an inner selection of formatted text as the wrapping format", () => {
    const state = createMarkdownState("A **bold** word");
    const bold = getInlineFormatSelectionElement(state, 4, 8);

    expect(bold).toMatchObject({
      kind: "strong",
      from: 2,
      to: 10,
      contentRange: { from: 4, to: 8 },
    });
    expect(getInlineFormatSelectionElement(state, 2, 10)?.kind).toBe("strong");
    expect(getInlineFormatSelectionElement(state, 0, 15)).toBeNull();
    expect(getInlineFormatSelectionElement(state, 4, 7)).toBeNull();
  });

  it("covers a format when the selection is inside the token, not only on its markers", () => {
    const state = createMarkdownState("A **bold** word");
    const inner = getInlineFormatCoverage(state, 4, 8, "strong");
    const partial = getInlineFormatCoverage(state, 4, 7, "strong");

    expect(inner.formats).toHaveLength(1);
    expect(inner.formats[0]?.kind).toBe("strong");
    expect(partial.formats).toHaveLength(1);
    expect(partial.neighbors).toHaveLength(1);
  });

  it("keeps a visible-content selection on the inner text rather than the wrapping markers", () => {
    const next = createMarkdownState("A **bold** word").update({
      selection: EditorSelection.range(4, 8),
    }).state;

    expect(next.selection.main.from).toBe(4);
    expect(next.selection.main.to).toBe(8);
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("bold");
  });

  it("keeps images atomic rather than inline-revealed", () => {
    const state = createMarkdownState("![alt](image.png)");
    const image = getMarkdownElements(state).find((element) => element.kind === "image");

    expect(image).toMatchObject({
      kind: "image",
      from: 0,
      to: 17,
    });
    expect(getInlineRevealElement(state, 4)).toBeNull();
  });

  it("can query elements for the current line without scanning unrelated lines", () => {
    const state = createMarkdownState("# Heading\nA **bold** word\n[[Target]]");
    const line = state.doc.line(2);
    const elements = getMarkdownElementsInRange(state, line.from, line.to);

    expect(elements.map((element) => element.kind)).toContain("strong");
    expect(elements.some((element) => element.kind === "heading")).toBe(false);
    expect(elements.some((element) => element.kind === "wikiLink")).toBe(false);
  });

  it("normalizes hidden block marker cursor positions to the visible start", () => {
    const state = createMarkdownState("# Heading");

    expect(getHiddenBlockMarkerCaretNormalization(state, 0)).toBe(2);
    expect(getHiddenBlockMarkerCaretNormalization(state, 1)).toBe(2);
    expect(getHiddenBlockMarkerCaretNormalization(state, 2)).toBeNull();
    expect(getBlockMarkerAtVisibleStart(state, 2)).toEqual({ from: 0, to: 2 });
  });

  it("normalizes escaped characters and autolinks", () => {
    const state = createMarkdownState("\\*escaped\\* <https://example.com>");
    const elements = getMarkdownElements(state);

    expect(elements.filter((element) => element.kind === "escape").map((element) => element.markerRanges)).toEqual([
      [{ from: 0, to: 1 }],
      [{ from: 9, to: 10 }],
    ]);
    expect(elements.find((element) => element.kind === "link")).toMatchObject({
      from: 12,
      to: 33,
      markerRanges: [
        { from: 12, to: 13 },
        { from: 32, to: 33 },
      ],
      contentRange: { from: 13, to: 32 },
    });
  });

  it("keeps markdown link titles out of the href", () => {
    expect(findMarkdownLinkTokens("[label](note.md \"Title\")")).toMatchObject([
      {
        from: 0,
        to: 24,
        label: "label",
        href: "note.md",
      },
    ]);
  });

  it("uses the full nested blockquote prefix for visible start while deleting one level", () => {
    const state = createMarkdownState(">> quote");

    expect(getHiddenBlockMarkerCaretNormalization(state, 0)).toBe(3);
    expect(getHiddenBlockMarkerCaretNormalization(state, 2)).toBe(3);
    expect(getBlockMarkerAtVisibleStart(state, 3)).toEqual({ from: 0, to: 1 });
  });
});
