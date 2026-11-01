import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import {
  createMarkdownBlockComplexity,
  MARKDOWN_RICH_BLOCK_EXECUTION,
} from "../../core/plans/markdownBlockExecution";
import { BLOCK_EMBED_CAPABILITIES, rangeOf, visibleSourcePlan } from "../../core/plans/planPrimitives";
import { getMarkdownFrontMatterEndLine } from "../../core/syntax/markdownFrontMatter";
import { FrontMatterWidget, parseMarkdownFrontMatter } from "./frontMatterWidget";

export const frontMatterFeature = defineMarkdownFeature({
  id: "front-matter",
  semanticKinds: ["frontMatter"],
  inlineWidgetKinds: [],
  blockWidgetKinds: ["frontMatter"],
  collectBlock(state, line) {
    if (line.number !== 1) return null;
    const endLine = getMarkdownFrontMatterEndLine(state.doc);
    if (endLine === null) return null;
    const closing = state.doc.line(endLine);
    const source = state.sliceDoc(state.doc.line(1).to + 1, closing.from);
    if (parseMarkdownFrontMatter(source).length === 0) return null;
    return {
      nextLineNumber: endLine + 1,
      element: {
        kind: "frontMatter",
        from: line.from,
        to: closing.to,
        markerRanges: [{ from: line.from, to: closing.to }],
        lineFrom: line.from,
        lineTo: closing.to,
        blockData: { kind: "frontMatter", source },
      },
    };
  },
  compile(element) {
    if (element.kind !== "frontMatter") return visibleSourcePlan(rangeOf(element), []);
    const { source } = element.blockData;
    return {
      presentation: "blockAtom",
      sourceRange: rangeOf(element),
      embed: { kind: "frontMatter", source },
      complexity: createMarkdownBlockComplexity(source, {
        logicalItems: 1,
        estimatedDomNodes: 8,
        nestingDepth: 1,
        assetCount: 0,
      }),
      execution: MARKDOWN_RICH_BLOCK_EXECUTION,
      layout: { estimatedHeight: 120 },
      diagnostics: [],
      capabilities: BLOCK_EMBED_CAPABILITIES,
    };
  },
  createBlockWidget(plan) {
    return new FrontMatterWidget(
      parseMarkdownFrontMatter(plan.embed.source),
      plan.sourceRange.to - plan.sourceRange.from,
      plan.embed.source,
    );
  },
});
