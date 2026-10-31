import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import { cloneRange, rangeOf } from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElements";

export function compileImageElementPlan(
  element: MarkdownElement,
): MarkdownElementPlan {
  if (element.kind !== "image") {
    return {
      presentation: "visibleSource",
      sourceRange: rangeOf(element),
      diagnostics: [],
      capabilities: { reveal: false, atomic: false, deleteUnits: [] },
    };
  }
  const imageData = element.blockData?.kind === "image" ? element.blockData : null;
  return {
    presentation: "inlineAtom",
    sourceRange: rangeOf(element),
    atom: {
      kind: "image",
      alt: imageData?.alt ?? "",
      href: imageData?.href ?? "",
      title: imageData?.title ?? null,
      referenceKind: imageData?.referenceKind ?? "markdown-path",
      displayMode: imageData?.displayMode ?? "inline",
    },
    layout: { lineBreaks: 0, estimatedHeight: 120 },
    diagnostics: imageData ? [] : [{ code: "image.missing-data", message: "image token data unavailable" }],
    capabilities: {
      reveal: false,
      atomic: true,
      deleteUnits: [cloneRange(rangeOf(element))],
      expand: true,
    },
  };
}
