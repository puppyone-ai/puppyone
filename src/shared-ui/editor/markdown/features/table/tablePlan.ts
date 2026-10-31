import type { MarkdownElementPlan } from "../../core/plans/markdownPlanTypes";
import {
  BLOCK_EMBED_CAPABILITIES,
  rangeOf,
  visibleSourcePlan,
} from "../../core/plans/planPrimitives";
import type { MarkdownElement } from "../../core/syntax/markdownElements";
import {
  createMarkdownTableRenderKey,
  estimateMarkdownTableLayoutHeight,
} from "./tableLayout";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  getMarkdownBudgetFallbackMessage,
  MARKDOWN_TABLE_MODEL_COLUMN_LIMIT,
  type MarkdownDocumentProfile,
} from "../../core/plans/markdownBlockExecution";

export function compileTableElementPlan(
  element: MarkdownElement,
  documentProfile: MarkdownDocumentProfile = "normal",
): MarkdownElementPlan {
  if (element.kind !== "table") return visibleSourcePlan(rangeOf(element), []);
  const tableData = element.blockData?.kind === "table" ? element.blockData : null;
  if (!tableData) {
    return visibleSourcePlan(rangeOf(element), [
      { code: "table.missing-data", message: "table block data unavailable" },
    ]);
  }
  if (!tableData.refinementValid) {
    return visibleSourcePlan(rangeOf(element), [{
      code: "table.refinement-failed",
      message: "parser-recognized table could not be refined safely",
    }]);
  }

  const assetCount = tableData.rows.reduce((total, row) => (
    total + row.cells.reduce((rowTotal, cell) => rowTotal + countImageCandidates(cell.text), 0)
  ), 0);
  const complexity = createMarkdownBlockComplexity("", {
    sourceBytes: tableData.sourceBytes,
    sourceLines: tableData.rowCount + 1,
    logicalItems: tableData.rowCount,
    estimatedDomNodes: 4 + tableData.rowCount + tableData.cellCount * 2,
    nestingDepth: 5,
    assetCount,
    maximumItemBreadth: tableData.modelComplete
      ? tableData.alignments.length
      : MARKDOWN_TABLE_MODEL_COLUMN_LIMIT + 1,
  });
  const execution = decideMarkdownBlockExecution("table", complexity, documentProfile);
  if (execution.mode === "visibleSource") {
    return visibleSourcePlan(rangeOf(element), [{
      code: "table.render-budget",
      message: getMarkdownBudgetFallbackMessage("table", execution),
    }]);
  }

  return {
    presentation: "blockAtom",
    sourceRange: rangeOf(element),
    embed: {
      kind: "table",
      alignments: tableData.alignments,
      rows: tableData.rows,
      renderKey: createMarkdownTableRenderKey(tableData.alignments, tableData.rows),
    },
    complexity,
    execution,
    layout: { estimatedHeight: estimateMarkdownTableLayoutHeight(tableData.rows) },
    diagnostics: [],
    capabilities: BLOCK_EMBED_CAPABILITIES,
  };
}

function countImageCandidates(source: string): number {
  let count = 0;
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] === "!" && source[index + 1] === "[") count += 1;
  }
  return count;
}
