import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import {
  getMarkdownTableBlock,
  getMarkdownTableSyntaxRange,
  isMarkdownTableSourceLine,
} from "./tableModel";
import { compileTableElementPlan } from "./tablePlan";
import { MarkdownTableWidget } from "./tableWidget";
import { markdownTableFocusExtension } from "./tableFocus";
import { markdownTableStructuralSelectionExtension } from "./tableStructuralSelectionState";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";

export function createTableFeature(renderInlinePreview: MarkdownInlinePreviewRenderer) {
  return defineMarkdownFeature({
    id: "table",
    semanticKinds: ["table"],
    inlineWidgetKinds: [],
    blockWidgetKinds: ["table"],
    livePreviewExtensions: [
      markdownTableFocusExtension,
      markdownTableStructuralSelectionExtension,
    ],
    collectBlock(state, line) {
      const syntaxRange = getMarkdownTableSyntaxRange(state, line.number);
      if (!syntaxRange) return null;
      const block = getMarkdownTableBlock(state, line.number, syntaxRange);
      if (!block || block.from !== line.from) return null;
      return {
        nextLineNumber: block.nextLineNumber,
        element: {
          kind: "table",
          from: block.from,
          to: block.to,
          markerRanges: [{ from: block.from, to: block.to }],
          lineFrom: line.from,
          lineTo: block.to,
          blockData: {
            kind: "table",
            alignments: block.alignments,
            rows: block.rows,
            rowCount: block.rowCount,
            cellCount: block.cellCount,
            sourceBytes: block.sourceBytes,
            modelComplete: block.modelComplete,
            refinementValid: block.refinementValid,
          },
        },
      };
    },
    compile(element, context) {
      return compileTableElementPlan(element, context.documentProfile);
    },
    createBlockWidget(plan, context) {
      const { embed, sourceRange } = plan;
      return new MarkdownTableWidget(
        sourceRange.from,
        sourceRange.to,
        [...embed.alignments],
        embed.rows.map((row) => ({
          header: row.header,
          lineTo: row.lineTo,
          cells: row.cells.map((cell) => ({ ...cell })),
        })),
        context.markdownLinkGraph,
        context.documentPath,
        context.markdownAssetUrlResolver,
        renderInlinePreview,
        plan.layout.estimatedHeight,
        embed.renderKey,
        plan.execution,
      );
    },
    lineClasses(source) {
      return isMarkdownTableSourceLine(source) ? ["cm-md-table-line"] : [];
    },
  });
}
