import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { CodeBlockWidget } from "./codeBlockWidget";
import { getMarkdownCodeBlock } from "./codeBlockModel";
import { compileCodeBlockElementPlan } from "./codeBlockPlan";

export const codeBlockFeature = defineMarkdownFeature({
  id: "code-block",
  semanticKinds: ["fence"],
  inlineWidgetKinds: [],
  blockWidgetKinds: ["codeBlock"],
  collectBlock(state, line) {
    const block = getMarkdownCodeBlock(state, line.number);
    if (!block || block.from !== line.from) return null;
    return {
      nextLineNumber: block.nextLineNumber,
      element: {
        kind: "fence",
        from: block.from,
        to: block.to,
        markerRanges: [{ from: block.from, to: block.to }],
        lineFrom: line.from,
        lineTo: block.to,
        blockData: {
          kind: "fence",
          language: block.language,
          sourceReference: block.sourceReference,
          code: block.code,
        },
      },
    };
  },
  compile(element, context) {
    return compileCodeBlockElementPlan(element, context.documentProfile);
  },
  createBlockWidget(plan) {
    const { embed, sourceRange } = plan;
    return new CodeBlockWidget(
      embed.code,
      embed.language,
      sourceRange.from,
      sourceRange.to,
      embed.sourceReference,
      plan.layout.estimatedHeight,
      plan.execution,
    );
  },
});
