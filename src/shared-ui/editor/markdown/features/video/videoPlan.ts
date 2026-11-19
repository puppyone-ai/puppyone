import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  type MarkdownDocumentProfile,
} from "../../core/plans/markdownBlockExecution";
import {
  BLOCK_EMBED_CAPABILITIES,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElements";

export function compileVideoElementPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile = "normal",
): MarkdownElementPlan {
  if (element.kind !== "video") return visibleSourcePlan(rangeOf(element), []);
  const videoData = element.blockData?.kind === "video" ? element.blockData : null;
  if (!videoData || videoData.model.sources.length === 0) {
    return visibleSourcePlan(rangeOf(element), [{
      code: "video.missing-source",
      message: "video source unavailable",
    }]);
  }

  const model = videoData.model;
  const complexity = createMarkdownBlockComplexity(
    model.sources.map((source) => source.href).join("\n"),
    {
      sourceLines: 1,
      logicalItems: model.sources.length,
      estimatedDomNodes: model.sources.length + 3,
      nestingDepth: 2,
      assetCount: model.sources.length + Number(Boolean(model.poster)),
    },
  );
  const execution = decideMarkdownBlockExecution("video", complexity, documentProfile);
  if (execution.mode === "visibleSource") return visibleSourcePlan(rangeOf(element), []);

  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: { kind: "video", model },
    complexity,
    execution,
    layout: { estimatedHeight: estimateMarkdownVideoHeight(model.width, model.height) },
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}

function estimateMarkdownVideoHeight(width: number | null, height: number | null): number {
  if (width && height) return Math.max(180, Math.min(720, height));
  return 360;
}
