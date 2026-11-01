import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { rangeOf } from "../../core/plans/planPrimitives";
import { visibleSourcePlan } from "../../core/plans/planPrimitives";
import { findMarkdownFootnoteMarkers } from "./footnoteModel";
import { FootnoteMarkerWidget } from "./footnoteWidget";

export const footnoteFeature = defineMarkdownFeature({
  id: "footnote",
  semanticKinds: ["footnote"],
  inlineWidgetKinds: ["footnote"],
  blockWidgetKinds: [],
  collectRange(state, from, to) {
    return findMarkdownFootnoteMarkers(state, from, to).map((marker) => ({
      kind: "footnote" as const,
      from: marker.from,
      to: marker.to,
      markerRanges: [{ from: marker.from, to: marker.to }],
      blockData: { kind: "footnote" as const, marker: marker.kind, id: marker.id, label: marker.label },
    }));
  },
  compile(element) {
    if (element.kind !== "footnote") return visibleSourcePlan(rangeOf(element), []);
    const { marker, id, label } = element.blockData;
    return {
      presentation: "inlineAtom",
      sourceRange: rangeOf(element),
      atom: { kind: "footnote", marker, id, label },
      layout: { lineBreaks: 0 },
      diagnostics: [],
      capabilities: { reveal: true, atomic: true, deleteUnits: [], expand: false },
    };
  },
  createInlineWidget(plan) {
    return new FootnoteMarkerWidget(plan.atom.marker, plan.atom.id, plan.atom.label);
  },
});
