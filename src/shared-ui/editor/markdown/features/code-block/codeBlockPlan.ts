import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  BLOCK_EMBED_CAPABILITIES,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElements";
import { isMermaidCodeBlockLanguage } from "./codeBlockModel";
import { estimateCodeBlockLayoutHeight, estimateMermaidLayoutHeight } from "./codeBlockLayout";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  getMarkdownBudgetFallbackMessage,
  type MarkdownBlockFeatureId,
  type MarkdownDocumentProfile,
} from "../../core/plans/markdownBlockExecution";
import { estimateMarkdownCodeHighlightDomNodes } from "./codeBlockHighlightBudget";

export function compileCodeBlockElementPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile = "normal",
): MarkdownElementPlan {
  if (element.kind !== "fence") return visibleSourcePlan(rangeOf(element), []);
  const fenceData = element.blockData?.kind === "fence" ? element.blockData : null;
  if (!fenceData) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "fence.missing-data", message: "fence block data unavailable" },
    ]);
  }

  const { language, sourceReference, code } = fenceData;
  const mermaid = isMermaidCodeBlockLanguage(language);
  const featureId: MarkdownBlockFeatureId = mermaid ? "mermaid" : "codeBlock";
  const sourceShape = scanSourceShape(code);
  const complexity = createMarkdownBlockComplexity(code, {
    sourceBytes: sourceShape.bytes,
    sourceLines: sourceShape.lines,
    logicalItems: mermaid ? sourceShape.nonEmptyLines : sourceShape.lines,
    estimatedDomNodes: mermaid
      ? Math.max(8, sourceShape.nonEmptyLines * 4)
      : 8 + estimateMarkdownCodeHighlightDomNodes(code),
    nestingDepth: 1,
    assetCount: 0,
  });
  const execution = decideMarkdownBlockExecution(featureId, complexity, documentProfile);
  if (execution.mode === "visibleSource") {
    return visibleSourcePlan(rangeOf(element), [{
      code: `${featureId}.render-budget`,
      message: getMarkdownBudgetFallbackMessage(featureId, execution),
    }]);
  }
  const sharedPlan = {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    complexity,
    execution,
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  } as const;
  if (mermaid) {
    return {
      ...sharedPlan,
      embed: { kind: "mermaid", language, sourceReference, code },
      layout: { estimatedHeight: estimateMermaidLayoutHeight(code) },
    };
  }
  return {
    ...sharedPlan,
    embed: { kind: "codeBlock", language, sourceReference, code },
    layout: { estimatedHeight: estimateCodeBlockLayoutHeight(code) },
  };
}

function scanSourceShape(source: string): { bytes: number; lines: number; nonEmptyLines: number } {
  let bytes = 0;
  let lines = 1;
  let nonEmptyLines = 0;
  let lineHasContent = false;
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < source.length) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (unit === 10) {
      if (lineHasContent) nonEmptyLines += 1;
      lines += 1;
      lineHasContent = false;
    } else if (unit !== 9 && unit !== 13 && unit !== 32) {
      lineHasContent = true;
    }
  }
  if (lineHasContent) nonEmptyLines += 1;
  return { bytes, lines, nonEmptyLines };
}
