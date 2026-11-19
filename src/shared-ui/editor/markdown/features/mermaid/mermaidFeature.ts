import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { MermaidBlockWidget } from "./mermaidBlockWidget";

/** Mermaid is a rendering specialization of the fenced-code semantic plan. */
export const mermaidFeature = defineMarkdownFeature({
  id: "mermaid",
  semanticKinds: [],
  inlineWidgetKinds: [],
  blockWidgetKinds: ["mermaid"],
  createBlockWidget(plan) {
    const { embed, sourceRange } = plan;
    return new MermaidBlockWidget(
      embed.code,
      embed.language || "mermaid",
      sourceRange.from,
      sourceRange.to,
      embed.sourceReference,
      plan.layout.estimatedHeight,
      plan.execution,
    );
  },
});
