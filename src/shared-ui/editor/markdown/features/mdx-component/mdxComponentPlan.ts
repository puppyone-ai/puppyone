import type { MarkdownElement } from "../../core/syntax/markdownElementTypes";
import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  BLOCK_EMBED_CAPABILITIES,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  getMarkdownBudgetFallbackMessage,
  type MarkdownDocumentProfile,
} from "../../core/plans/markdownBlockExecution";

export function compileMdxComponentElementPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile,
): MarkdownElementPlan {
  if (element.kind !== "mdxComponent") return visibleSourcePlan(rangeOf(element), []);
  const component = element.blockData?.kind === "mdxComponent"
    ? element.blockData.component
    : null;
  if (!component) {
    return visibleSourcePlan(rangeOf(element), [{
      code: "mdx-component.missing-data",
      message: "component semantic data unavailable",
    }]);
  }
  if (component.status !== "complete" || component.kind !== "tabs") {
    return visibleSourcePlan(rangeOf(element), [{
      code: `mdx-component.${component.status}`,
      message: component.diagnostic ?? "component preview unavailable",
    }]);
  }

  const complexity = createMarkdownBlockComplexity(component.source, {
    logicalItems: component.metrics.logicalItems,
    estimatedDomNodes: component.metrics.estimatedDomNodes + component.tabs.length * 3,
    nestingDepth: component.metrics.nestingDepth,
    assetCount: component.metrics.assetCount,
    maximumItemBreadth: component.tabs.length,
  });
  const execution = decideMarkdownBlockExecution("mdxComponent", complexity, documentProfile);
  if (execution.mode === "visibleSource") {
    return visibleSourcePlan(rangeOf(element), [{
      code: "mdx-component.render-budget",
      message: getMarkdownBudgetFallbackMessage("mdxComponent", execution),
    }]);
  }

  const contentLines = Math.max(1, ...component.tabs.map((tab) => (
    tab.content.split(/\r?\n/).length
  )));
  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: {
      kind: "mdxComponent",
      name: "Tabs",
      tabs: component.tabs,
      source: component.source,
    },
    complexity,
    execution,
    layout: { estimatedHeight: 58 + Math.min(480, contentLines * 24) },
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}

