import type { EditorState } from "@codemirror/state";
import { markdownDialectFacet } from "../dialect/markdownDialect";
import { getMarkdownPlanIndex } from "../plans/markdownPlanIndex";
import type { MarkdownElementKind } from "../syntax/markdownElementTypes";
import type { MarkdownDialectId } from "../../../registry/viewerTypes";

export type MarkdownConformanceEntry = Readonly<{
  kind: MarkdownElementKind;
  from: number;
  to: number;
  presentation: "inlineMark" | "inlineAtom" | "blockAtom" | "visibleSource";
  diagnosticCodes: readonly string[];
  htmlProfile: string | null;
}>;

export type MarkdownConformanceSnapshot = Readonly<{
  dialect: MarkdownDialectId;
  sourceLength: number;
  entries: readonly MarkdownConformanceEntry[];
}>;

export type MarkdownConformanceSurface =
  | "live-editable"
  | "live-read-only"
  | "fragment"
  | "export"
  | "index";

export type MarkdownSurfaceConformanceEntry = MarkdownConformanceEntry & Readonly<{
  disposition: "render" | "preserve-source" | "semantic-only";
}>;

/**
 * Serializable, surface-neutral projection boundary. Live/read-only adapters,
 * exporters, and indexers can reduce capabilities from this snapshot without
 * inventing another syntax classification or source-range model.
 */
export function getMarkdownConformanceSnapshot(
  state: EditorState,
): MarkdownConformanceSnapshot {
  return {
    dialect: state.facet(markdownDialectFacet),
    sourceLength: state.doc.length,
    entries: getMarkdownPlanIndex(state).map(({ element, plan }) => ({
      kind: element.kind,
      from: plan.sourceRange.from,
      to: plan.sourceRange.to,
      presentation: plan.presentation,
      diagnosticCodes: plan.diagnostics.map((diagnostic) => diagnostic.code),
      htmlProfile: plan.presentation === "blockAtom" && plan.embed.kind === "htmlBlock"
        ? plan.embed.profile
        : null,
    })),
  };
}

/**
 * Capability reduction only: ranges, kinds, and diagnostics are immutable
 * across surfaces. Export preserves canonical source, indexing consumes only
 * semantics, and fragment adapters render inline plans while preserving block
 * source. No surface is allowed to upgrade visibleSource to rich rendering.
 */
export function projectMarkdownConformanceSurface(
  snapshot: MarkdownConformanceSnapshot,
  surface: MarkdownConformanceSurface,
): readonly MarkdownSurfaceConformanceEntry[] {
  return snapshot.entries.map((entry) => ({
    ...entry,
    disposition: getSurfaceDisposition(entry, surface),
  }));
}

function getSurfaceDisposition(
  entry: MarkdownConformanceEntry,
  surface: MarkdownConformanceSurface,
): MarkdownSurfaceConformanceEntry["disposition"] {
  if (entry.presentation === "visibleSource") return "preserve-source";
  if (surface === "index") return "semantic-only";
  if (surface === "export") return "preserve-source";
  if (surface === "fragment" && entry.presentation === "blockAtom") return "preserve-source";
  return "render";
}
