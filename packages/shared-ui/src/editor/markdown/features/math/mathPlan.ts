import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  BLOCK_EMBED_CAPABILITIES,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import { createMarkdownBlockComplexity, MARKDOWN_RICH_BLOCK_EXECUTION } from "../../core/plans/markdownBlockExecution";
import type { MarkdownElement } from "../../core/syntax/markdownElements";

const MAX_RICH_MATH_SOURCE_UNITS = 32 * 1024;

export function compileMathElementPlan(element: MarkdownElement): MarkdownElementPlan {
  if (element.kind !== "mathBlock" && element.kind !== "mathInline") {
    return visibleSourcePlan(rangeOf(element), [
      { code: "math.missing-data", message: "math source unavailable" },
    ]);
  }
  const mathData = element.blockData;
  if (!mathData.source.trim()) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "math.empty-source", message: "math source is empty" },
    ]);
  }
  if (mathData.source.length > MAX_RICH_MATH_SOURCE_UNITS) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "math.source-too-large", message: "math source exceeds the rich-preview limit" },
    ]);
  }

  if (element.kind === "mathInline") {
    return {
      presentation: "inlineAtom",
      sourceRange: rangeOf(element),
      atom: { kind: "mathInline", source: mathData.source },
      layout: { lineBreaks: 0 },
      diagnostics: [],
      capabilities: {
        reveal: false,
        atomic: true,
        deleteUnits: element.markerRanges.map((range) => ({ ...range })),
        expand: true,
      },
    };
  }

  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: { kind: "mathBlock", source: mathData.source },
    complexity: createMarkdownBlockComplexity(mathData.source, {
      logicalItems: 1,
      estimatedDomNodes: Math.max(4, Math.ceil(mathData.source.length / 8)),
      nestingDepth: 1,
      assetCount: 0,
    }),
    execution: MARKDOWN_RICH_BLOCK_EXECUTION,
    layout: { estimatedHeight: 96 },
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}
