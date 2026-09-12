import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { addInlineMarkdownDecorations } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/inlineDecorations";
import {
  markdownLivePreviewDecorations,
  requestMarkdownProjectionRange,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/livePreviewDecorations";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownHtmlBlock } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/htmlBlockModel";
import { compileInlineHtmlRenderPlan } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlPolicy";
import { isAllowedStyleProperty } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlSanitizerPolicy";
import {
  getMarkdownInlineHtml,
  getMarkdownInlineHtmlDiagnostics,
  getMarkdownInlineHtmlInRange,
  resetMarkdownInlineHtmlDiagnostics,
  type MarkdownInlineHtml,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlModel";
import {
  parseMarkdownHtmlTagToken,
  scanMarkdownHtmlTagTokens,
} from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/htmlTagTokenizer";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { getInlineRevealElement } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import { InlineHtmlLineBreakWidget } from "../../../../../../packages/shared-ui/src/editor/markdown/core/widgets/inlineWidgets";
import { getMarkdownPlansInRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

function getCompleteInlineHtml(source: string, tagName = "span"): MarkdownInlineHtml {
  const element = getMarkdownInlineHtml(createMarkdownState(source)).find((candidate) => (
    candidate.tagName === tagName && candidate.status === "complete" && candidate.closingMarker !== null
  ));
  if (!element) throw new Error(`Expected complete <${tagName}> in ${source}`);
  return element;
}

function buildInlineDecorations(source: string, reveal: { from: number; to: number } | null = null) {
  const state = createMarkdownState(source);
  const line = state.doc.line(1);
  const builders = {
    decorations: [],
    atomicRanges: [],
  } satisfies Parameters<typeof addInlineMarkdownDecorations>[3];

  addInlineMarkdownDecorations(
    state,
    line.from,
    line.text,
    builders,
    reveal,
    null,
    "safe",
    null,
    "",
    null,
    getMarkdownPlansInRange(state, line.from, line.to),
  );
  return builders;
}

function getInlineHtmlDecorationRanges(state: EditorState) {
  const ranges: Array<{ from: number; to: number }> = [];
  state.field(markdownLivePreviewDecorations).decorations.between(
    0,
    state.doc.length,
    (from, to, decoration) => {
      if (decoration.spec.class === "cm-md-inline-html") ranges.push({ from, to });
    },
  );
  return ranges;
}

describe("Markdown inline HTML semantic model", () => {
  it("normalizes a styled span inside a list item", () => {
    const source = '- <span style="color: #B45309;">四层资产对应的产品截图或示意素材</span>';
    const element = getCompleteInlineHtml(source);
    const openingTo = source.indexOf(">") + 1;
    const closingFrom = source.indexOf("</span>");

    expect(element).toMatchObject({
      kind: "inlineHtml",
      from: 2,
      to: source.length,
      tagName: "span",
      openingMarker: { from: 2, to: openingTo },
      contentRange: { from: openingTo, to: closingFrom },
      closingMarker: { from: closingFrom, to: source.length },
      status: "complete",
    });
    expect(element.attributes).toMatchObject([
      { name: "style", value: "color: #B45309;" },
    ]);
  });

  it("supports nested inline HTML and Markdown without flattening ranges", () => {
    const source = '<span style="color: red"><em>This is **important**</em></span>';
    const state = createMarkdownState(source);
    const elements = getMarkdownInlineHtml(state);

    expect(elements.filter((element) => element.status === "complete").map((element) => element.tagName)).toEqual([
      "span",
      "em",
    ]);
    expect(getInlineRevealElement(state, source.indexOf("important") + 2)?.kind).toBe("strong");
  });

  it("keeps adjacent elements independent", () => {
    const source = '<span style="color: red">red</span> <span style="color: blue">blue</span>';
    const elements = getMarkdownInlineHtml(createMarkdownState(source)).filter((element) => element.status === "complete");

    expect(elements.map((element) => ({ tagName: element.tagName, from: element.from, to: element.to }))).toEqual([
      { tagName: "span", from: 0, to: source.indexOf("</span>") + 7 },
      { tagName: "span", from: source.indexOf("<span", 1), to: source.length },
    ]);
  });

  it("pairs tags across soft line breaks in the same paragraph", () => {
    const source = "Text <span>one\ntwo</span> end";
    const element = getCompleteInlineHtml(source);

    expect(element.contentRange).toEqual({
      from: source.indexOf(">") + 1,
      to: source.indexOf("</span>"),
    });
  });

  it("pairs a whole semantic container while constructing only the requested range", () => {
    const source = "Text <span>one\ntwo</span> end";
    const state = createMarkdownState(source);
    const secondLine = state.doc.line(2);

    const [element] = getMarkdownInlineHtmlInRange(state, secondLine.from, secondLine.to);

    expect(element).toMatchObject({
      from: source.indexOf("<span>"),
      to: source.indexOf("</span>") + "</span>".length,
      status: "complete",
    });
  });

  it("keeps an HTML-heavy 10,000-line range query bounded to its paragraph", () => {
    const source = Array.from({ length: 5_000 }, (_, index) => (
      `<span data-index="${index}">paragraph ${index}</span>\n`
    )).join("\n");
    const state = createMarkdownState(source);
    const targetLine = state.doc.line(101);
    expect(ensureSyntaxTree(state, targetLine.to, 3_000)).not.toBeNull();
    resetMarkdownInlineHtmlDiagnostics();

    const elements = getMarkdownInlineHtmlInRange(state, targetLine.from, targetLine.to);

    expect(elements).toHaveLength(1);
    expect(elements[0]?.status).toBe("complete");
    expect(getMarkdownInlineHtmlDiagnostics()).toMatchObject({
      fullDocumentScans: 0,
      rangeScans: 1,
      containersScanned: 1,
      tokensScanned: 2,
    });
  });

  it("renders the motivating styled strong label instead of exposing its tags", () => {
    const source = '<strong style="color: #92400E;">团队待提供：</strong>';
    const builders = buildInlineDecorations(source);
    const mark = builders.decorations.find((range) => (
      range.value.spec.class === "cm-md-inline-html"
    ));

    expect(mark?.value.spec.tagName).toBe("strong");
    expect(mark?.value.spec.attributes).toEqual({ style: "color: #92400E" });
  });

  it("keeps incomplete and mismatched tags out of reveal state", () => {
    const incompleteSource = "Text <span>unfinished";
    const incompleteState = createMarkdownState(incompleteSource);
    const incomplete = getMarkdownInlineHtml(incompleteState).find((element) => element.tagName === "span");

    expect(incomplete?.status).toBe("incomplete");
    expect(getInlineRevealElement(incompleteState, incompleteSource.length - 1)).toBeNull();

    const malformed = getMarkdownInlineHtml(createMarkdownState("<span><em>x</span></em>"));
    expect(malformed.every((element) => element.status !== "complete")).toBe(true);
  });

  it("tokenizes quoted tag delimiters and unquoted URL slashes safely", () => {
    const token = parseMarkdownHtmlTagToken('<span title="1 > 0" data-url=https://example.com/a>');

    expect(token).toMatchObject({
      tagName: "span",
      closing: false,
      selfClosing: false,
      attributes: [
        { name: "title", value: "1 > 0" },
        { name: "data-url", value: "https://example.com/a" },
      ],
    });
  });

  it("does not let plain less-than text hide a later closing tag", () => {
    const tokens = scanMarkdownHtmlTagTokens("<script>if (a < b) run()</script>");

    expect(tokens.map((token) => ({ tagName: token.tagName, closing: token.closing }))).toEqual([
      { tagName: "script", closing: false },
      { tagName: "script", closing: true },
    ]);
  });

  it("invalidates semantic caches and projects a newly parsed viewport", () => {
    const early = '<span style="color: red">early</span>';
    const late = '<span style="color: blue">late</span>';
    const filler = Array.from({ length: 2_500 }, (_, index) => (
      `- Paragraph ${index}: **context** [reference](note-${index}.md) ${"detail ".repeat(6)}`
    )).join("\n");
    const source = `${early}\n${filler}\n${late}`;
    const initialState = EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension(),
      ],
    });

    expect(syntaxTree(initialState).length).toBeLessThan(initialState.doc.length);
    expect(getMarkdownInlineHtml(initialState).some((element) => element.from === source.indexOf(late))).toBe(false);
    expect(getInlineHtmlDecorationRanges(initialState)).toHaveLength(1);

    expect(ensureSyntaxTree(initialState, initialState.doc.length, 3_000)).not.toBeNull();
    const parsedState = initialState.update({}).state;

    expect(parsedState.doc).toBe(initialState.doc);
    expect(syntaxTree(parsedState).length).toBe(parsedState.doc.length);
    expect(getMarkdownInlineHtml(parsedState).some((element) => element.from === source.indexOf(late))).toBe(true);
    const projectedState = parsedState.update({
      effects: requestMarkdownProjectionRange(
        parsedState,
        source.indexOf(late),
        source.indexOf(late) + late.length,
      ),
    }).state;
    expect(getInlineHtmlDecorationRanges(projectedState)).toHaveLength(2);
  });
});

describe("Markdown inline HTML policy", () => {
  it("compiles the presentation-only style subset", () => {
    const result = compileInlineHtmlRenderPlan(
      getCompleteInlineHtml('<span style="color: #B45309; font-weight: 700">text</span>'),
    );

    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.value).toMatchObject({
      kind: "mark",
      tagName: "span",
      attributes: { style: "color: #B45309; font-weight: 700" },
      profile: "inline-editable",
    });
  });

  it("compiles a bare br into a typed line-break plan", () => {
    const element = getMarkdownInlineHtml(createMarkdownState("before<br>after"))
      .find((candidate) => candidate.tagName === "br");

    expect(element).toBeDefined();
    const result = element && compileInlineHtmlRenderPlan(element);
    expect(result).toMatchObject({
      supported: true,
      value: { kind: "lineBreak", profile: "inline-editable" },
    });
  });

  it("uses a narrower style capability in inline surfaces than sandboxed blocks", () => {
    expect(isAllowedStyleProperty("color", "inline")).toBe(true);
    expect(isAllowedStyleProperty("display", "inline")).toBe(false);
    expect(isAllowedStyleProperty("display", "block")).toBe(true);
  });

  it("reduces unsafe attributes while preserving honest safe structure", () => {
    const reducedDisplay = compileInlineHtmlRenderPlan(
      getCompleteInlineHtml('<span style="display: none; color: red">text</span>'),
    );
    expect(reducedDisplay.supported).toBe(true);
    if (reducedDisplay.supported && reducedDisplay.value.kind === "mark") {
      expect(reducedDisplay.value.attributes.style).toBe("color: red");
      expect(reducedDisplay.value.diagnostics.some((item) => item.message.includes("display"))).toBe(true);
    }

    const reducedEvent = compileInlineHtmlRenderPlan(
      getCompleteInlineHtml('<span onclick="alert(1)" style="color: blue">text</span>'),
    );
    expect(reducedEvent.supported).toBe(true);
    if (reducedEvent.supported && reducedEvent.value.kind === "mark") {
      expect(reducedEvent.value.attributes).toEqual({ style: "color: blue" });
      expect(reducedEvent.value.diagnostics.some((item) => item.code === "inline-html.event-handler")).toBe(true);
    }
  });

  it("rejects blocked executable tags", () => {
    const result = compileInlineHtmlRenderPlan(getCompleteInlineHtml("before <script>alert(1)</script>", "script"));
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reasons.join(" ")).toContain("script");
  });

  it("rejects unsafe style url() values", () => {
    const result = compileInlineHtmlRenderPlan(
      getCompleteInlineHtml('<span style="color: url(https://example.com/x)">text</span>'),
    );
    expect(result.supported).toBe(true);
    if (result.supported && result.value.kind === "mark") {
      expect(result.value.attributes.style ?? "").not.toContain("url");
      expect(result.value.diagnostics.some((item) => item.message.includes("color"))).toBe(true);
    }
  });
});

describe("Markdown inline HTML live decorations", () => {
  it("marks safe content and atomically hides only the HTML markers", () => {
    const source = '- <span style="color: #B45309;">orange</span>';
    const element = getCompleteInlineHtml(source);
    const builders = buildInlineDecorations(source);
    const htmlMark = builders.decorations.find((range) => range.value.spec.class === "cm-md-inline-html");

    expect(htmlMark).toMatchObject({
      from: element.contentRange?.from,
      to: element.contentRange?.to,
    });
    expect(htmlMark?.value.spec).toMatchObject({
      tagName: "span",
      attributes: { style: "color: #B45309" },
    });
    expect(builders.atomicRanges.map(({ from, to }) => ({ from, to }))).toEqual([
      element.openingMarker,
      element.closingMarker,
    ]);
  });

  it("renders br as an atomic typed widget and reveals its source on demand", () => {
    const source = "before<br>after";
    const from = source.indexOf("<br>");
    const to = from + "<br>".length;
    const collapsed = buildInlineDecorations(source);
    const lineBreak = collapsed.decorations.find((range) => (
      range.value.spec.widget instanceof InlineHtmlLineBreakWidget
    ));

    expect(lineBreak).toMatchObject({ from, to });
    expect(collapsed.atomicRanges).toContain(lineBreak);

    const revealed = buildInlineDecorations(source, { from, to });
    expect(revealed.decorations.some((range) => (
      range.value.spec.widget instanceof InlineHtmlLineBreakWidget
    ))).toBe(false);
    expect(revealed.decorations.some((range) => (
      range.from === from &&
      range.to === to &&
      range.value.spec.class === "cm-md-source-syntax cm-md-source-syntax-inline-html"
    ))).toBe(true);
  });

  it("keeps nested Markdown decorations while rendering the outer HTML mark", () => {
    const source = '<span style="color: red">This is **important**</span>';
    const builders = buildInlineDecorations(source);
    const classes = builders.decorations.map((range) => range.value.spec.class).filter(Boolean);

    expect(classes).toContain("cm-md-inline-html");
    expect(classes).toContain("cm-md-syntax-strong");
  });

  it("composes nested Markdown marks instead of reserving the outer range", () => {
    const builders = buildInlineDecorations("**bold and _italic_**");
    const classes = builders.decorations.map((range) => range.value.spec.class).filter(Boolean);

    expect(classes).toContain("cm-md-syntax-strong");
    expect(classes).toContain("cm-md-syntax-emphasis");
  });

  it("reveals HTML markers without dropping the safe content style", () => {
    const source = '<span style="color: red">text</span>';
    const element = getCompleteInlineHtml(source);
    const builders = buildInlineDecorations(source, { from: element.from, to: element.to });

    expect(builders.decorations.some((range) => range.value.spec.class === "cm-md-inline-html")).toBe(true);
    expect(builders.decorations.filter((range) => (
      String(range.value.spec.class).includes("cm-md-source-syntax-inline-html")
    ))).toHaveLength(2);
    expect(builders.atomicRanges).toHaveLength(0);
  });

  it("leaves unsupported inline HTML source visible", () => {
    const source = "before <script>alert(1)</script>";
    const builders = buildInlineDecorations(source);

    expect(builders.decorations.filter((range) => range.value.spec.class === "cm-md-inline-html")).toHaveLength(0);
    expect(builders.atomicRanges).toHaveLength(0);
  });

  it("keeps safe structure after reducing blocked style capabilities", () => {
    const source = '<span style="display: none; color: red">text</span>';
    const builders = buildInlineDecorations(source);
    const htmlMark = builders.decorations.find((range) => range.value.spec.class === "cm-md-inline-html");

    expect(htmlMark?.value.spec.attributes).toEqual({ style: "color: red" });
  });
});

describe("Markdown HTML block classification", () => {
  it("uses Lezer block context instead of line-start tag guessing", () => {
    const inlineState = createMarkdownState('<strong style="color: red">text</strong>');
    expect(getMarkdownHtmlBlock(inlineState, 1)).toBeNull();

    const blockSource = "<div>\ncontent\n</div>";
    const blockState = createMarkdownState(blockSource);
    expect(getMarkdownHtmlBlock(blockState, 1)).toMatchObject({
      from: 0,
      to: blockSource.length,
      nextLineNumber: 4,
      tagName: "div",
      status: "complete",
    });
    expect(getMarkdownHtmlBlock(blockState, 2)).toBeNull();

    const scriptBlock = getMarkdownHtmlBlock(
      createMarkdownState("<script>\nif (a < b) run()\n</script>"),
      1,
    );
    expect(scriptBlock).toMatchObject({ tagName: "script", status: "complete" });
  });
});
