import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";
import { getMarkdownHtmlBlock, isStandaloneMediaHtmlLine } from "./htmlBlockModel";
import { HtmlBlockWidget } from "./htmlBlockWidget";
import { HtmlRunWidget } from "./htmlRunWidget";
import { getMarkdownInlineHtmlInRange, readMarkdownInlineHtmlRunSource } from "./inlineHtmlModel";
import { compileHtmlBlockElementPlan, compileInlineHtmlElementPlan } from "./htmlPlan";
import { markdownFragmentTargetsFacet } from "../../core/links/markdownFragmentTargets";
import { getMarkdownInlineHtmlAnchors } from "./inlineHtmlAnchors";

export const createHtmlFeature = (renderInlinePreview: MarkdownInlinePreviewRenderer) => defineMarkdownFeature({
  id: "html",
  semanticKinds: ["inlineHtml", "htmlBlock"],
  inlineWidgetKinds: ["htmlRun"],
  blockWidgetKinds: ["htmlBlock"],
  livePreviewExtensions: [markdownFragmentTargetsFacet.of(getMarkdownInlineHtmlAnchors)],
  collectRange(state, from, to) {
    return getMarkdownInlineHtmlInRange(state, from, to)
      .filter((inlineHtml) => (
        inlineHtml.runRole !== "member"
        && !(
          inlineHtml.runRole === "owner"
          && isStandaloneMediaHtmlLine(state, state.doc.lineAt(inlineHtml.from).number)
        )
      ))
      .map((inlineHtml) => ({
        kind: "inlineHtml" as const,
        from: inlineHtml.from,
        to: inlineHtml.to,
        markerRanges: [
          inlineHtml.openingMarker,
          ...(inlineHtml.closingMarker ? [inlineHtml.closingMarker] : []),
        ],
        contentRange: inlineHtml.contentRange ?? undefined,
        inlineHtml: inlineHtml.runRole === "owner"
          ? { ...inlineHtml, runSource: readMarkdownInlineHtmlRunSource(state, inlineHtml) }
          : inlineHtml,
      }));
  },
  collectBlock(state, line) {
    const block = getMarkdownHtmlBlock(state, line.number);
    if (!block) return null;
    return {
      nextLineNumber: block.nextLineNumber,
      element: {
        kind: "htmlBlock",
        from: block.from,
        to: block.to,
        markerRanges: [{ from: block.from, to: block.to }],
        lineFrom: block.from,
        lineTo: state.doc.line(block.nextLineNumber - 1).to,
        blockData: {
          kind: "htmlBlock",
          tagName: block.tagName,
          status: block.status,
          diagnostic: block.diagnostic,
          source: block.source,
          metrics: block.metrics,
        },
      },
    };
  },
  compile(element, context) {
    return element.kind === "inlineHtml"
      ? compileInlineHtmlElementPlan(element, context.assetBrokerAvailable)
      : compileHtmlBlockElementPlan(
          element,
          context.documentProfile,
          context.assetBrokerAvailable,
        );
  },
  createInlineWidget(plan, context) {
    return new HtmlRunWidget(
      {
        source: plan.atom.source,
        rootIsBlock: plan.atom.rootIsBlock,
        profileVersion: plan.atom.profileVersion,
      },
      context.documentPath,
      context.markdownAssetUrlResolver,
      renderInlinePreview,
    );
  },
  createBlockWidget(plan, context) {
    const { embed, sourceRange } = plan;
    return new HtmlBlockWidget(
      {
        from: sourceRange.from,
        to: sourceRange.to,
        nextLineNumber: 0,
        source: embed.source,
        tagName: embed.tagName ?? "",
        profile: embed.profile,
        profileVersion: embed.profileVersion,
        requiresAssetBroker: embed.requiresAssetBroker,
        externalHref: embed.externalHref,
        metrics: {
          logicalItems: plan.complexity.logicalItems,
          estimatedDomNodes: plan.complexity.estimatedDomNodes,
          nestingDepth: plan.complexity.nestingDepth,
          assetCount: plan.complexity.assetCount,
        },
      },
      context.documentPath,
      context.markdownAssetUrlResolver,
      plan.layout.estimatedHeight,
      plan.execution,
    );
  },
});
