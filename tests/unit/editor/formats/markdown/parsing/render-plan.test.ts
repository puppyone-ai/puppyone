import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";

import { compilePuppyMarkdownElementPlan, puppyMarkdownFeatureCompositionExtension, puppyMarkdownParserExtensions } from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { getCollapsedMarkerDeletionUnit, getMarkdownPlanIndex, getMarkdownPlansInRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { MARKDOWN_HTML_PROFILE_VERSION } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlProfiles";

import { getMarkdownElements } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

describe("Markdown render-plan compiler", () => {
  it("compiles styled span list items into inlineMark plans", () => {
    const source = '- <span style="color: #B45309;">screenshot</span>';
    const element = getMarkdownElements(createMarkdownState(source)).find((candidate) => candidate.kind === "inlineHtml");
    expect(element).toBeDefined();
    const plan = compilePuppyMarkdownElementPlan(element!);
    expect(plan.presentation).toBe("inlineMark");
    if (plan.presentation === "inlineMark") {
      expect(plan.mark.tagName).toBe("span");
      expect(plan.mark.attributes.style).toBe("color: #B45309");
      expect(plan.capabilities.deleteUnits).toHaveLength(2);
      expect(plan.capabilities.reveal).toBe(true);
    }
  });

  it("compiles bare br into an expandable inlineAtom with lineBreaks metadata", () => {
    const source = "before<br>after";
    const element = getMarkdownElements(createMarkdownState(source)).find((candidate) => (
      candidate.kind === "inlineHtml" && candidate.inlineHtml.tagName === "br"
    ));
    const plan = compilePuppyMarkdownElementPlan(element!);
    expect(plan).toMatchObject({
      presentation: "inlineAtom",
      atom: { kind: "lineBreak" },
      layout: { lineBreaks: 1 },
      capabilities: { expand: true, atomic: true },
    });
  });

  it("keeps incomplete inline HTML as visibleSource without deletion units", () => {
    const source = "Text <span>unfinished";
    const element = getMarkdownElements(createMarkdownState(source)).find((candidate) => candidate.kind === "inlineHtml");
    const plan = compilePuppyMarkdownElementPlan(element!);
    expect(plan.presentation).toBe("visibleSource");
    expect(plan.capabilities.deleteUnits).toEqual([]);
    expect(getCollapsedMarkerDeletionUnit(createMarkdownState(source), source.length, "backward")).toBeNull();
  });

  it("indexes plans by document and syntax tree identity", () => {
    const state = createMarkdownState('<kbd>Cmd</kbd> + <span style="color: red">R</span>');
    const plans = getMarkdownPlanIndex(state);
    expect(plans.some((entry) => entry.plan.presentation === "inlineMark")).toBe(true);
    expect(MARKDOWN_HTML_PROFILE_VERSION).toMatch(/^2026-/);
  });

  it("compiles fence and table blocks into blockAtom plans with payload", () => {
    const source = [
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const plans = getMarkdownPlanIndex(createMarkdownState(source));
    const fence = plans.find((entry) => entry.plan.presentation === "blockAtom" && entry.plan.embed.kind === "codeBlock");
    const table = plans.find((entry) => entry.plan.presentation === "blockAtom" && entry.plan.embed.kind === "table");
    expect(fence?.plan).toMatchObject({
      presentation: "blockAtom",
      embed: { kind: "codeBlock", language: "ts", code: "const x = 1;" },
    });
    expect(table?.plan.presentation).toBe("blockAtom");
    if (table?.plan.presentation === "blockAtom" && table.plan.embed.kind === "table") {
      expect(table.plan.embed.rows.length).toBeGreaterThanOrEqual(2);
      expect(table.plan.embed.alignments.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("propagates the refined table boundary through the canonical plan index", () => {
    const prose = "**First, this remains a paragraph.**";
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      prose,
    ].join("\n");
    const state = createMarkdownState(source);
    const proseFrom = source.indexOf(prose);
    const tableEntry = getMarkdownPlanIndex(state).find(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "table"
    ));

    expect(tableEntry?.plan.sourceRange).toEqual({ from: 0, to: proseFrom - 1 });
    expect(tableEntry?.element).toMatchObject({ from: 0, to: proseFrom - 1 });
    if (tableEntry?.plan.presentation === "blockAtom" && tableEntry.plan.embed.kind === "table") {
      expect(tableEntry.plan.embed.rows).toHaveLength(2);
    }
    expect(getMarkdownPlansInRange(state, proseFrom, source.length).some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "table"
    ))).toBe(false);
    expect(getMarkdownPlansInRange(state, proseFrom, source.length).some(({ element }) => (
      element.kind === "strong"
    ))).toBe(true);
  });

  it("carries legacy code-source references into the block plan", () => {
    const source = [
      "```83:99:package.json",
      '{"private": true}',
      "```",
    ].join("\n");
    const plan = getMarkdownPlanIndex(createMarkdownState(source))
      .find((entry) => entry.plan.presentation === "blockAtom")?.plan;

    expect(plan).toMatchObject({
      presentation: "blockAtom",
      embed: {
        kind: "codeBlock",
        language: "json",
        sourceReference: {
          path: "package.json",
          startLine: 83,
          endLine: 99,
        },
      },
    });
  });
});
