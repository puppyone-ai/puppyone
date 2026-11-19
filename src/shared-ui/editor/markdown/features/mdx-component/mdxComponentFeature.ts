import { syntaxTree } from "@codemirror/language";
import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";
import { parseMarkdownMdxComponent } from "./mdxComponentModel";
import { compileMdxComponentElementPlan } from "./mdxComponentPlan";
import { markdownMdxComponentParserExtension } from "./mdxComponentSyntax";
import { MarkdownMdxTabsWidget } from "./mdxTabsWidget";

export function createMdxComponentFeature(renderInlinePreview: MarkdownInlinePreviewRenderer) {
  return defineMarkdownFeature({
    id: "mdx-component",
    semanticKinds: ["mdxComponent"],
    inlineWidgetKinds: [],
    blockWidgetKinds: ["mdxComponent"],
    parserExtensions: [markdownMdxComponentParserExtension],
    collectBlock(state, line) {
      let node = syntaxTree(state).resolve(line.from, 1);
      while (node && node.name !== "MdxComponentBlock" && node.parent) node = node.parent;
      if (node.name !== "MdxComponentBlock" || node.from !== line.from) return null;
      const source = state.sliceDoc(node.from, node.to);
      const component = parseMarkdownMdxComponent(source, node.from);
      return {
        nextLineNumber: state.doc.lineAt(Math.max(node.from, node.to - 1)).number + 1,
        element: {
          kind: "mdxComponent",
          from: node.from,
          to: node.to,
          markerRanges: [{ from: node.from, to: node.to }],
          lineFrom: line.from,
          lineTo: node.to,
          blockData: { kind: "mdxComponent", component },
        },
      };
    },
    compile(element, context) {
      return compileMdxComponentElementPlan(element, context.documentProfile);
    },
    createBlockWidget(plan, context) {
      const { embed, sourceRange } = plan;
      return new MarkdownMdxTabsWidget(
        sourceRange.from,
        sourceRange.to,
        embed.source,
        embed.tabs,
        context.markdownLinkGraph,
        context.documentPath,
        renderInlinePreview,
        plan.layout.estimatedHeight,
        plan.execution,
      );
    },
  });
}

