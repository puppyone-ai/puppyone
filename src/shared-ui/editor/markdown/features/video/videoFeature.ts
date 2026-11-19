import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { getObsidianMediaEmbedNodesInRange } from "../media/markdownMediaSyntaxNode";
import {
  createMarkdownVideoModel,
  createMarkdownVideoTokenFromObsidianEmbed,
} from "./markdownVideoModel";
import { resolveMarkdownVideoModel } from "./resolveMarkdownVideoModel";
import { compileVideoElementPlan } from "./videoPlan";
import { VideoPreviewWidget } from "./videoPreviewWidget";

export const videoFeature = defineMarkdownFeature({
  id: "video",
  semanticKinds: ["video"],
  inlineWidgetKinds: [],
  blockWidgetKinds: ["video"],
  collectBlock(state, line) {
    const mediaToken = getObsidianMediaEmbedNodesInRange(
      state,
      line.from,
      line.to,
      "video",
    ).find((candidate) => (
      !state.sliceDoc(line.from, candidate.from).trim()
      && !state.sliceDoc(candidate.to, line.to).trim()
    ));
    if (!mediaToken) return null;
    const token = createMarkdownVideoTokenFromObsidianEmbed(mediaToken);
    return {
      nextLineNumber: line.number + 1,
      element: {
        kind: "video",
        from: mediaToken.from,
        to: mediaToken.to,
        markerRanges: [{ from: mediaToken.from, to: mediaToken.to }],
        lineFrom: line.from,
        lineTo: line.to,
        blockData: {
          kind: "video",
          model: createMarkdownVideoModel(token),
        },
      },
    };
  },
  compile(element, context) {
    return compileVideoElementPlan(element, context.documentProfile);
  },
  createBlockWidget(plan, context) {
    return new VideoPreviewWidget(
      plan.sourceRange.from,
      plan.sourceRange.to,
      resolveMarkdownVideoModel(
        plan.embed.model,
        context.documentPath,
        context.markdownLinkGraph,
      ),
      context.documentPath,
      plan.layout.estimatedHeight,
    );
  },
});
