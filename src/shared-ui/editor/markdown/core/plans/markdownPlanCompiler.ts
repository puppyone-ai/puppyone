import type { MarkdownElement } from "../syntax/markdownElements";
import type { MarkdownFeatureComposition } from "../features/markdownFeatureContract";
import type { MarkdownElementPlan } from "./markdownPlanTypes";
import { BLOCK_EMBED_CAPABILITIES, cloneRange, rangeOf, visibleSourcePlan } from "./planPrimitives";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  type MarkdownDocumentProfile,
} from "./markdownBlockExecution";

export type MarkdownPlanCompileContext = Readonly<{
  documentProfile: MarkdownDocumentProfile;
  featureComposition: MarkdownFeatureComposition | null;
  assetBrokerAvailable: boolean;
}>;

const DEFAULT_COMPILE_CONTEXT: MarkdownPlanCompileContext = Object.freeze({
  documentProfile: "normal",
  featureComposition: null,
  assetBrokerAvailable: false,
});

/**
 * Compiles a semantic Markdown element into a typed render plan.
 * Incomplete / malformed / unrenderable constructs become visibleSource and
 * therefore have no collapsed-marker deletion capability.
 */
export function compileMarkdownElementPlan(
  element: MarkdownElement,
  context: MarkdownPlanCompileContext = DEFAULT_COMPILE_CONTEXT,
): MarkdownElementPlan {
  const featurePlan = context.featureComposition?.compileElement(element, {
    documentProfile: context.documentProfile,
    assetBrokerAvailable: context.assetBrokerAvailable,
  }) ?? null;
  if (featurePlan) return featurePlan;

  switch (element.kind) {
    case "strong":
      return compileDelimitedInlineMarkPlan(element, "strong", "cm-md-syntax-strong");
    case "emphasis":
      return compileDelimitedInlineMarkPlan(element, "emphasis", "cm-md-syntax-emphasis");
    case "strike":
      return compileDelimitedInlineMarkPlan(element, "strike", "cm-md-syntax-strikethrough");
    case "inlineCode":
      return compileDelimitedInlineMarkPlan(element, "inlineCode", "cm-md-syntax-monospace");
    case "link":
    case "wikiLink":
      return compileLinkLikePlan(element);
    case "escape":
      return {
        presentation: "inlineAtom",
        sourceRange: rangeOf(element),
        atom: { kind: "escape" },
        layout: { lineBreaks: 0 },
        diagnostics: [],
        capabilities: {
          reveal: false,
          atomic: true,
          deleteUnits: element.markerRanges.map(cloneRange),
          expand: false,
        },
      };
    case "rule":
      return compileHorizontalRuleAtomPlan(element, context.documentProfile);
    case "task":
      return compileTaskCheckboxAtomPlan(element);
    default:
      return visibleSourcePlan(rangeOf(element), []);
  }
}

function compileDelimitedInlineMarkPlan(
  element: MarkdownElement,
  kind: "strong" | "emphasis" | "strike" | "inlineCode",
  className: string,
): MarkdownElementPlan {
  const contentRange = element.contentRange;
  if (!contentRange || contentRange.from >= contentRange.to) {
    return visibleSourcePlan(rangeOf(element), [
      { code: `${kind}.empty-content`, message: `${kind} content range is empty` },
    ]);
  }

  return {
    presentation: "inlineMark",
    sourceRange: rangeOf(element),
    contentRange: cloneRange(contentRange),
    markerRanges: element.markerRanges.map(cloneRange),
    mark: {
      kind,
      className,
      attributes: {},
    },
    diagnostics: [],
    capabilities: {
      reveal: true,
      atomic: true,
      deleteUnits: element.markerRanges.map(cloneRange),
    },
  };
}

function compileLinkLikePlan(element: MarkdownElement): MarkdownElementPlan {
  if (element.kind !== "link" && element.kind !== "wikiLink") {
    return visibleSourcePlan(rangeOf(element), []);
  }

  const contentRange = element.contentRange;
  if (!contentRange || contentRange.from >= contentRange.to) {
    return visibleSourcePlan(rangeOf(element), [
      { code: `${element.kind}.empty-content`, message: `${element.kind} content range is empty` },
    ]);
  }

  return {
    presentation: "inlineMark",
    sourceRange: rangeOf(element),
    contentRange: cloneRange(contentRange),
    markerRanges: element.markerRanges.map(cloneRange),
    mark: {
      kind: element.kind,
      className: element.kind === "wikiLink" ? "cm-md-wiki-link-label" : "cm-md-link-label",
      attributes: {},
    },
    diagnostics: [],
    capabilities: {
      reveal: true,
      atomic: true,
      deleteUnits: element.markerRanges.map(cloneRange),
    },
  };
}

function compileHorizontalRuleAtomPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile,
): MarkdownElementPlan {
  const complexity = createMarkdownBlockComplexity("", {
    // Horizontal-rule source is ASCII, so the mapped source width is also its
    // exact UTF-8 byte count without requiring compiler access to the document.
    sourceBytes: Math.max(0, element.to - element.from),
    sourceLines: 1,
    logicalItems: 1,
    estimatedDomNodes: 1,
    nestingDepth: 1,
    assetCount: 0,
  });
  const execution = decideMarkdownBlockExecution("horizontalRule", complexity, documentProfile);
  if (execution.mode === "visibleSource") return visibleSourcePlan(rangeOf(element), []);
  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: { kind: "horizontalRule" },
    complexity,
    execution,
    layout: { estimatedHeight: 37 },
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}

function compileTaskCheckboxAtomPlan(element: MarkdownElement): MarkdownElementPlan {
  const taskData = element.blockData?.kind === "task" ? element.blockData : null;
  if (!taskData) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "task.missing-data", message: "task data unavailable" },
    ]);
  }

  const sourceRange = element.markerRanges[1] ?? rangeOf(element);
  return {
    presentation: "inlineAtom",
    sourceRange: cloneRange(sourceRange),
    atom: { kind: "taskCheckbox", checked: taskData.checked },
    layout: { lineBreaks: 0 },
    diagnostics: [],
    capabilities: {
      reveal: false,
      atomic: true,
      deleteUnits: [cloneRange(sourceRange)],
      expand: false,
    },
  };
}
