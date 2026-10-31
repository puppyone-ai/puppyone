import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { findMarkdownInlineMathTokens, getMarkdownMathBlock } from "./mathModel";
import { compileMathElementPlan } from "./mathPlan";
import { MathBlockWidget, MathInlineWidget } from "./mathWidget";

export const mathFeature = defineMarkdownFeature({
  id: "math",
  semanticKinds: ["mathBlock", "mathInline"],
  inlineWidgetKinds: ["mathInline"],
  blockWidgetKinds: ["mathBlock"],
  collectRange(state, from, to) {
    return findMarkdownInlineMathTokens(state, from, to).map((token) => ({
      kind: "mathInline" as const,
      from: token.from,
      to: token.to,
      markerRanges: [
        { from: token.from, to: token.contentFrom },
        { from: token.contentTo, to: token.to },
      ],
      contentRange: { from: token.contentFrom, to: token.contentTo },
      blockData: { kind: "mathInline" as const, source: token.source },
    }));
  },
  collectBlock(state, line) {
    const block = getMarkdownMathBlock(state, line.number);
    if (!block || block.from !== line.from) return null;
    return {
      nextLineNumber: block.nextLineNumber,
      element: {
        kind: "mathBlock",
        from: block.from,
        to: block.to,
        markerRanges: [
          { from: block.from, to: block.contentFrom },
          { from: block.contentTo, to: block.to },
        ],
        contentRange: { from: block.contentFrom, to: block.contentTo },
        lineFrom: block.from,
        lineTo: block.to,
        blockData: { kind: "mathBlock", source: block.source },
      },
    };
  },
  compile(element) {
    return compileMathElementPlan(element);
  },
  createInlineWidget(plan) {
    return new MathInlineWidget(
      plan.sourceRange.from,
      plan.sourceRange.to,
      plan.atom.source,
    );
  },
  createBlockWidget(plan) {
    return new MathBlockWidget(
      plan.sourceRange.from,
      plan.sourceRange.to,
      plan.embed.source,
      plan.layout.estimatedHeight,
    );
  },
});
