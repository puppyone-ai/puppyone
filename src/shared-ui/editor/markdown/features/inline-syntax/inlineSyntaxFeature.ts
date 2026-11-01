import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import { cloneRange, rangeOf, visibleSourcePlan } from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElementTypes";
import { collectMarkdownInlineSyntax } from "./inlineSyntaxModel";
import { markdownInlineSyntaxParserExtension } from "./inlineSyntaxParser";
import { decodeHtmlEntity, InlineTextAtomWidget } from "./inlineTextAtomWidget";

export const inlineSyntaxFeature = defineMarkdownFeature({
  id: "inline-syntax",
  semanticKinds: ["comment", "emoji", "entity", "highlight"],
  inlineWidgetKinds: ["emoji", "entity"],
  blockWidgetKinds: [],
  parserExtensions: [markdownInlineSyntaxParserExtension],
  collectRange(state, from, to) {
    return collectMarkdownInlineSyntax(state, from, to);
  },
  compile(element) {
    return compileInlineSyntaxPlan(element);
  },
  createInlineWidget(plan) {
    if (plan.atom.kind === "emoji") {
      const { emoji } = plan.atom;
      return new InlineTextAtomWidget(() => emoji, `emoji:${emoji}`);
    }
    const { source } = plan.atom;
    return new InlineTextAtomWidget(() => decodeHtmlEntity(source), `entity:${source}`);
  },
});

function compileInlineSyntaxPlan(element: MarkdownElement): MarkdownElementPlan {
  const sourceRange = rangeOf(element);
  // The caret reveals these atoms, so a keystroke edits one character at a time.
  const textAtom = {
    presentation: "inlineAtom",
    sourceRange,
    layout: { lineBreaks: 0 },
    diagnostics: [],
    capabilities: { reveal: true, atomic: true, deleteUnits: [], expand: false },
  } as const;
  if (element.kind === "emoji") {
    return { ...textAtom, atom: { kind: "emoji", emoji: element.blockData.emoji } };
  }
  if (element.kind === "entity") {
    return { ...textAtom, atom: { kind: "entity", source: element.blockData.source } };
  }
  if ((element.kind !== "highlight" && element.kind !== "comment") || !element.contentRange) {
    return visibleSourcePlan(sourceRange, []);
  }
  return {
    presentation: "inlineMark",
    sourceRange,
    contentRange: cloneRange(element.contentRange),
    markerRanges: element.markerRanges.map(cloneRange),
    mark: {
      kind: element.kind,
      className: element.kind === "highlight" ? "cm-md-syntax-highlight" : "cm-md-comment",
      attributes: {},
    },
    diagnostics: [],
    capabilities: {
      reveal: element.kind === "highlight",
      atomic: true,
      deleteUnits: element.markerRanges.map(cloneRange),
    },
  };
}
