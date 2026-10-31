import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  BLOCK_EMBED_CAPABILITIES,
  cloneRange,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElements";
import { compileInlineHtmlRenderPlan } from "./inlineHtmlPolicy";
import { estimateHtmlBlockLayoutHeight } from "./htmlBlockLayout";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  getMarkdownBudgetFallbackMessage,
  type MarkdownDocumentProfile,
} from "../../core/plans/markdownBlockExecution";
import { compileMarkdownHtmlBlockPolicy } from "./htmlBlockPolicy";

export function compileInlineHtmlElementPlan(
  element: Extract<MarkdownElement, { kind: "inlineHtml" }>,
): MarkdownElementPlan {
  const sourceRange = rangeOf(element);
  const policy = compileInlineHtmlRenderPlan(element.inlineHtml);

  if (!policy.supported) return visibleSourcePlan(sourceRange, policy.diagnostics);

  if (policy.value.kind === "lineBreak") {
    return {
      presentation: "inlineAtom",
      sourceRange,
      atom: { kind: "lineBreak" },
      layout: { lineBreaks: 1 },
      diagnostics: policy.value.diagnostics,
      capabilities: {
        reveal: true,
        atomic: true,
        deleteUnits: [cloneRange(sourceRange)],
        expand: true,
      },
    };
  }

  const contentRange = element.contentRange;
  const emptyAnchor = contentRange?.from === contentRange?.to
    && policy.value.tagName === "a"
    && Boolean(policy.value.attributes.id);
  if (!contentRange || (contentRange.from >= contentRange.to && !emptyAnchor)) {
    return visibleSourcePlan(sourceRange, [
      ...policy.value.diagnostics,
      { code: "inline-html.empty-content", message: "inline HTML content range is empty" },
    ]);
  }

  // A target-only anchor has no visible text. Keep its source as one atomic
  // marker so deletion cannot leave half a tag pair or a caret between tags.
  const markerRanges = emptyAnchor ? [sourceRange] : element.markerRanges;

  return {
    presentation: "inlineMark",
    sourceRange,
    contentRange: cloneRange(contentRange),
    markerRanges: markerRanges.map(cloneRange),
    mark: {
      kind: "inlineHtmlMark",
      tagName: policy.value.tagName,
      className: "cm-md-inline-html",
      attributes: policy.value.attributes,
    },
    diagnostics: policy.value.diagnostics,
    capabilities: {
      reveal: true,
      atomic: true,
      deleteUnits: markerRanges.map(cloneRange),
    },
  };
}

export function compileHtmlBlockElementPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile = "normal",
  assetBrokerAvailable = false,
): MarkdownElementPlan {
  if (element.kind !== "htmlBlock") return visibleSourcePlan(rangeOf(element), []);
  const htmlData = element.blockData?.kind === "htmlBlock" ? element.blockData : null;
  if (!htmlData) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "htmlBlock.missing-data", message: "HTML block data unavailable" },
    ]);
  }
  const policy = compileMarkdownHtmlBlockPolicy({
    source: htmlData.source,
    status: htmlData.status,
    diagnostic: htmlData.diagnostic,
    assetBrokerAvailable,
  });
  if (!policy.supported) {
    return visibleSourcePlan(rangeOf(element), [{
      code: policy.diagnostic.code,
      message: policy.diagnostic.message,
    }]);
  }

  const complexity = createMarkdownBlockComplexity(htmlData.source, {
    logicalItems: htmlData.metrics.logicalItems,
    estimatedDomNodes: htmlData.metrics.estimatedDomNodes,
    nestingDepth: htmlData.metrics.nestingDepth,
    assetCount: htmlData.metrics.assetCount,
  });
  const execution = decideMarkdownBlockExecution("htmlBlock", complexity, documentProfile);
  if (execution.mode === "visibleSource") {
    return visibleSourcePlan(rangeOf(element), [{
      code: "htmlBlock.render-budget",
      message: getMarkdownBudgetFallbackMessage("htmlBlock", execution),
    }]);
  }

  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: {
      kind: "htmlBlock",
      tagName: htmlData.tagName,
      source: htmlData.source,
      profile: policy.profile,
      profileVersion: policy.profileVersion,
      requiresAssetBroker: policy.requiresAssetBroker,
      externalHref: policy.externalHref,
    },
    complexity,
    execution,
    layout: { estimatedHeight: estimateHtmlBlockLayoutHeight(htmlData.source) },
    diagnostics: policy.diagnostics,
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}
