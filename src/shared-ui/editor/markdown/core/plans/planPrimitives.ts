import type {
  BlockEmbedCapabilities,
  MarkdownDiagnostic,
  MarkdownElementPlan,
  SourceRange,
} from "./markdownPlanTypes";

export const BLOCK_EMBED_CAPABILITIES: BlockEmbedCapabilities = {
  reveal: false,
  atomic: true,
  deleteUnits: [],
};

export function visibleSourcePlan(
  sourceRange: SourceRange,
  diagnostics: readonly MarkdownDiagnostic[],
): MarkdownElementPlan {
  return {
    presentation: "visibleSource",
    sourceRange,
    diagnostics,
    capabilities: { reveal: false, atomic: false, deleteUnits: [] },
  };
}

export function rangeOf(element: { from: number; to: number }): SourceRange {
  return { from: element.from, to: element.to };
}

export function cloneRange(range: SourceRange): SourceRange {
  return { from: range.from, to: range.to };
}
