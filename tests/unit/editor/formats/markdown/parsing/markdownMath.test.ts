import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  markdownFeatureComposition,
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

describe("Markdown math", () => {
  it("compiles a display-math block into a registered block widget plan", () => {
    const source = "$$\nE = \\sum_{i=1}^{n} \\frac{1}{2} m_i v_i^2 + \\frac{1}{2} k x^2\n$$";
    const entry = getMarkdownPlanIndex(createMarkdownState(source)).find(({ element }) => (
      element.kind === "mathBlock"
    ));

    expect(entry?.element).toMatchObject({
      kind: "mathBlock",
      from: 0,
      to: source.length,
      blockData: {
        kind: "mathBlock",
        source: "E = \\sum_{i=1}^{n} \\frac{1}{2} m_i v_i^2 + \\frac{1}{2} k x^2",
      },
    });
    expect(entry?.plan).toMatchObject({
      presentation: "blockAtom",
      embed: {
        kind: "mathBlock",
        source: "E = \\sum_{i=1}^{n} \\frac{1}{2} m_i v_i^2 + \\frac{1}{2} k x^2",
      },
    });
    if (!entry || entry.plan.presentation !== "blockAtom") return;
    expect(markdownFeatureComposition.createBlockWidget(entry.plan, {
      htmlTrustMode: "safe",
      markdownLinkGraph: null,
      documentPath: "notes/physics.md",
      markdownAssetUrlResolver: null,
    })).not.toBeNull();
  });

  it("compiles delimited inline math into a registered inline widget plan", () => {
    const source = "Einstein wrote $E = mc^2$ in 1905.";
    const entry = getMarkdownPlanIndex(createMarkdownState(source)).find(({ element }) => (
      element.kind === "mathInline"
    ));

    expect(entry?.element).toMatchObject({
      kind: "mathInline",
      from: 15,
      to: 25,
      contentRange: { from: 16, to: 24 },
    });
    expect(entry?.plan).toMatchObject({
      presentation: "inlineAtom",
      atom: { kind: "mathInline", source: "E = mc^2" },
    });
    if (!entry || entry.plan.presentation !== "inlineAtom") return;
    expect(markdownFeatureComposition.createInlineWidget(entry.plan, {
      htmlTrustMode: "safe",
      markdownLinkGraph: null,
      documentPath: "notes/physics.md",
      markdownAssetUrlResolver: null,
    })).not.toBeNull();
  });

  it("does not treat code spans, escaped dollars, or currency text as math", () => {
    const source = "`$code$` and \\$escaped$ cost $5 and later $10";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline" || element.kind === "mathBlock"
    ));

    expect(mathEntries).toHaveLength(0);
  });

  it("does not treat a compact currency range as math", () => {
    const source = "Costs range from $5-$10.";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline" || element.kind === "mathBlock"
    ));

    expect(mathEntries).toHaveLength(0);
  });

  it.each([
    ["math before code", "$x$`code`"],
    ["math after code", "`code`$x$"],
    ["math before HTML", "$x$<b>label</b>"],
    ["math after HTML", "<b>label</b>$x$"],
  ])("keeps %s when suppressed syntax is only adjacent", (_label, source) => {
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline"
    ));

    expect(mathEntries).toHaveLength(1);
    expect(mathEntries[0]?.element.blockData).toMatchObject({ source: "x" });
  });

  it("allows a valid formula to be followed by a digit", () => {
    const source = "$x$5";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline"
    ));

    expect(mathEntries).toHaveLength(1);
    expect(mathEntries[0]?.element.blockData).toMatchObject({ source: "x" });
  });

  it("keeps separate formulas separate when the first is followed by a digit", () => {
    const source = "$x$2 + $y$";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline"
    ));

    expect(mathEntries.map(({ element }) => element.kind === "mathInline" ? element.blockData.source : null)).toEqual(["x", "y"]);
  });

  it("does not let a compact currency range consume a later formula", () => {
    const source = "Costs $5-$10 and math $y$.";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline"
    ));

    expect(mathEntries.map(({ element }) => element.kind === "mathInline" ? element.blockData.source : null)).toEqual(["y"]);
  });

  it("does not let inline math cross into an inline-code span", () => {
    const source = "Outside $x `inside$` tail";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline" || element.kind === "mathBlock"
    ));

    expect(mathEntries).toHaveLength(0);
  });

  it("does not close a display formula with a delimiter inside a code fence", () => {
    const source = "$$\nx\n```text\n$$\n```";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline" || element.kind === "mathBlock"
    ));

    expect(mathEntries).toHaveLength(0);
  });

  it("leaves an unclosed display-math block as visible source", () => {
    const source = "$$\nE = mc^2";
    const mathEntries = getMarkdownPlanIndex(createMarkdownState(source)).filter(({ element }) => (
      element.kind === "mathInline" || element.kind === "mathBlock"
    ));

    expect(mathEntries).toHaveLength(0);
    expect(createMarkdownState(source).doc.toString()).toBe(source);
  });

  it("falls back to visible source for an oversized formula", () => {
    const source = `$$\n${"x+".repeat(20_000)}x\n$$`;
    const entry = getMarkdownPlanIndex(createMarkdownState(source)).find(({ element }) => (
      element.kind === "mathBlock"
    ));

    expect(entry?.plan).toMatchObject({
      presentation: "visibleSource",
      diagnostics: [{ code: "math.source-too-large" }],
    });
  });
});
