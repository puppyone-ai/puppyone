export const MARKDOWN_RENDER_BUDGET_VERSION = "2026-07-14.1";
export const MARKDOWN_RICH_BLOCK_EXECUTION = Object.freeze({
  mode: "rich" as const,
  budgetVersion: MARKDOWN_RENDER_BUDGET_VERSION,
});

export type MarkdownDocumentProfile = "normal" | "large" | "extreme";

export type MarkdownBlockFeatureId =
  | "codeBlock"
  | "htmlBlock"
  | "horizontalRule"
  | "mermaid"
  | "mdxComponent"
  | "table"
  | "video";

export type MarkdownBlockComplexity = Readonly<{
  sourceBytes: number;
  sourceLines: number;
  logicalItems: number;
  estimatedDomNodes: number;
  nestingDepth: number;
  assetCount: number;
  maximumItemBreadth: number;
}>;

export type MarkdownBudgetReason =
  | "async-work"
  | "dom-nodes"
  | "nesting-depth"
  | "source-bytes"
  | "source-lines"
  | "logical-items";

export type MarkdownBlockExecution =
  | Readonly<{ mode: "rich"; budgetVersion: string }>
  | Readonly<{
      mode: "windowed";
      budgetVersion: string;
      overscanItems: number;
    }>
  | Readonly<{
      mode: "deferred";
      budgetVersion: string;
      reason: MarkdownBudgetReason;
    }>
  | Readonly<{
      mode: "visibleSource";
      budgetVersion: string;
      reason: MarkdownBudgetReason;
    }>;

export type MarkdownMountedBlockExecution = Exclude<
  MarkdownBlockExecution,
  Readonly<{ mode: "visibleSource"; budgetVersion: string; reason: MarkdownBudgetReason }>
>;

export type MarkdownDocumentComplexity = Readonly<{
  sourceUnits: number;
  lines: number;
}>;

export type MarkdownBlockBudgetDiagnostics = Readonly<{
  decisions: number;
  byMode: Readonly<Record<MarkdownBlockExecution["mode"], number>>;
  byFeature: Readonly<Record<MarkdownBlockFeatureId, number>>;
}>;

const TABLE_RICH_ROWS = Object.freeze({ normal: 120, large: 80, extreme: 40 });
const TABLE_RICH_DOM_NODES = Object.freeze({ normal: 5_000, large: 3_000, extreme: 1_500 });
const TABLE_RICH_BYTES = Object.freeze({ normal: 256 * 1024, large: 160 * 1024, extreme: 96 * 1024 });
export const MARKDOWN_TABLE_MODEL_ROW_LIMIT = 5_000;
export const MARKDOWN_TABLE_MODEL_CELL_LIMIT = 50_000;
export const MARKDOWN_TABLE_MODEL_COLUMN_LIMIT = 64;
export const MARKDOWN_TABLE_MODEL_ROW_BYTE_LIMIT = 64 * 1024;
export const MARKDOWN_TABLE_MODEL_SOURCE_BYTE_LIMIT = 4 * 1024 * 1024;
const TABLE_WINDOWED_MAX_LOGICAL_NODES = 120_000;
const TABLE_OVERSCAN_ROWS = 8;

const HTML_RICH_BYTES = Object.freeze({ normal: 48 * 1024, large: 32 * 1024, extreme: 16 * 1024 });
const HTML_RICH_NODES = Object.freeze({ normal: 800, large: 500, extreme: 250 });
const HTML_RICH_DEPTH = Object.freeze({ normal: 48, large: 40, extreme: 32 });
const HTML_RICH_ASSETS = Object.freeze({ normal: 32, large: 20, extreme: 12 });
const HTML_DEFERRED_MAX_BYTES = 256 * 1024;
const HTML_DEFERRED_MAX_NODES = 5_000;
const HTML_DEFERRED_MAX_DEPTH = 96;
const HTML_DEFERRED_MAX_ASSETS = 128;

const CODE_RICH_LINES = Object.freeze({ normal: 512, large: 320, extreme: 160 });
const CODE_RICH_BYTES = Object.freeze({ normal: 128 * 1024, large: 96 * 1024, extreme: 48 * 1024 });

const MERMAID_RICH_BYTES = Object.freeze({ normal: 32 * 1024, large: 24 * 1024, extreme: 12 * 1024 });
const MERMAID_RICH_ITEMS = Object.freeze({ normal: 1_000, large: 700, extreme: 350 });
const MERMAID_DEFERRED_MAX_BYTES = 128 * 1024;
const MERMAID_DEFERRED_MAX_ITEMS = 4_000;

const diagnostics = {
  decisions: 0,
  byMode: {
    rich: 0,
    windowed: 0,
    deferred: 0,
    visibleSource: 0,
  } satisfies Record<MarkdownBlockExecution["mode"], number>,
  byFeature: {
    codeBlock: 0,
    htmlBlock: 0,
    horizontalRule: 0,
    mermaid: 0,
    mdxComponent: 0,
    table: 0,
    video: 0,
  } satisfies Record<MarkdownBlockFeatureId, number>,
};

export function getMarkdownDocumentProfile(
  complexity: MarkdownDocumentComplexity,
): MarkdownDocumentProfile {
  if (complexity.sourceUnits > 10 * 1024 * 1024 || complexity.lines > 250_000) return "extreme";
  if (complexity.sourceUnits > 1024 * 1024 || complexity.lines > 50_000) return "large";
  return "normal";
}

export function decideMarkdownBlockExecution(
  featureId: MarkdownBlockFeatureId,
  complexity: MarkdownBlockComplexity,
  documentProfile: MarkdownDocumentProfile,
): MarkdownBlockExecution {
  const execution = decide(featureId, complexity, documentProfile);
  diagnostics.decisions += 1;
  diagnostics.byMode[execution.mode] += 1;
  diagnostics.byFeature[featureId] += 1;
  return execution;
}

export function getMarkdownBlockBudgetDiagnostics(): MarkdownBlockBudgetDiagnostics {
  return {
    decisions: diagnostics.decisions,
    byMode: { ...diagnostics.byMode },
    byFeature: { ...diagnostics.byFeature },
  };
}

export function resetMarkdownBlockBudgetDiagnostics() {
  diagnostics.decisions = 0;
  for (const mode of Object.keys(diagnostics.byMode) as MarkdownBlockExecution["mode"][]) {
    diagnostics.byMode[mode] = 0;
  }
  for (const feature of Object.keys(diagnostics.byFeature) as MarkdownBlockFeatureId[]) {
    diagnostics.byFeature[feature] = 0;
  }
}

export function createMarkdownBlockComplexity(
  source: string,
  values: Omit<MarkdownBlockComplexity, "sourceBytes" | "sourceLines" | "maximumItemBreadth"> & {
    sourceBytes?: number;
    sourceLines?: number;
    maximumItemBreadth?: number;
  },
): MarkdownBlockComplexity {
  return Object.freeze({
    sourceBytes: values.sourceBytes ?? getUtf8ByteLength(source),
    sourceLines: values.sourceLines ?? countLines(source),
    logicalItems: Math.max(0, Math.floor(values.logicalItems)),
    estimatedDomNodes: Math.max(0, Math.floor(values.estimatedDomNodes)),
    nestingDepth: Math.max(0, Math.floor(values.nestingDepth)),
    assetCount: Math.max(0, Math.floor(values.assetCount)),
    maximumItemBreadth: Math.max(0, Math.floor(values.maximumItemBreadth ?? 1)),
  });
}

export function getMarkdownBudgetFallbackMessage(
  featureId: MarkdownBlockFeatureId,
  execution: Extract<MarkdownBlockExecution, { mode: "visibleSource" }>,
): string {
  return `${featureId} rich preview disabled by ${execution.reason} budget (${execution.budgetVersion})`;
}

export function getUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function decide(
  featureId: MarkdownBlockFeatureId,
  complexity: MarkdownBlockComplexity,
  profile: MarkdownDocumentProfile,
): MarkdownBlockExecution {
  switch (featureId) {
    case "horizontalRule":
    case "video":
      return rich();
    case "mdxComponent":
      if (complexity.sourceBytes > HTML_RICH_BYTES[profile]) return visibleSource("source-bytes");
      if (complexity.estimatedDomNodes > HTML_RICH_NODES[profile]) return visibleSource("dom-nodes");
      if (complexity.nestingDepth > HTML_RICH_DEPTH[profile]) return visibleSource("nesting-depth");
      return rich();
    case "table":
      if (
        complexity.logicalItems <= TABLE_RICH_ROWS[profile]
        && complexity.estimatedDomNodes <= TABLE_RICH_DOM_NODES[profile]
        && complexity.sourceBytes <= TABLE_RICH_BYTES[profile]
      ) {
        return rich();
      }
      if (complexity.sourceBytes > MARKDOWN_TABLE_MODEL_SOURCE_BYTE_LIMIT) {
        return visibleSource("source-bytes");
      }
      if (complexity.logicalItems > MARKDOWN_TABLE_MODEL_ROW_LIMIT) return visibleSource("logical-items");
      if (complexity.maximumItemBreadth > MARKDOWN_TABLE_MODEL_COLUMN_LIMIT) {
        return visibleSource("logical-items");
      }
      if (complexity.estimatedDomNodes > TABLE_WINDOWED_MAX_LOGICAL_NODES) return visibleSource("dom-nodes");
      return {
        mode: "windowed",
        budgetVersion: MARKDOWN_RENDER_BUDGET_VERSION,
        overscanItems: TABLE_OVERSCAN_ROWS,
      };
    case "htmlBlock": {
      const richReason = firstExceededHtmlRichBudget(complexity, profile);
      if (!richReason) return rich();
      if (complexity.sourceBytes > HTML_DEFERRED_MAX_BYTES) return visibleSource("source-bytes");
      if (complexity.estimatedDomNodes > HTML_DEFERRED_MAX_NODES) return visibleSource("dom-nodes");
      if (complexity.nestingDepth > HTML_DEFERRED_MAX_DEPTH) return visibleSource("nesting-depth");
      if (complexity.assetCount > HTML_DEFERRED_MAX_ASSETS) return visibleSource("logical-items");
      return deferred(richReason);
    }
    case "codeBlock":
      if (complexity.sourceBytes > CODE_RICH_BYTES[profile]) return visibleSource("source-bytes");
      if (complexity.sourceLines > CODE_RICH_LINES[profile]) return visibleSource("source-lines");
      return rich();
    case "mermaid":
      if (
        complexity.sourceBytes <= MERMAID_RICH_BYTES[profile]
        && complexity.logicalItems <= MERMAID_RICH_ITEMS[profile]
      ) {
        return rich();
      }
      if (complexity.sourceBytes > MERMAID_DEFERRED_MAX_BYTES) return visibleSource("source-bytes");
      if (complexity.logicalItems > MERMAID_DEFERRED_MAX_ITEMS) return visibleSource("logical-items");
      return deferred("async-work");
  }
}

function firstExceededHtmlRichBudget(
  complexity: MarkdownBlockComplexity,
  profile: MarkdownDocumentProfile,
): MarkdownBudgetReason | null {
  if (complexity.sourceBytes > HTML_RICH_BYTES[profile]) return "source-bytes";
  if (complexity.estimatedDomNodes > HTML_RICH_NODES[profile]) return "dom-nodes";
  if (complexity.nestingDepth > HTML_RICH_DEPTH[profile]) return "nesting-depth";
  if (complexity.assetCount > HTML_RICH_ASSETS[profile]) return "logical-items";
  return null;
}

function rich(): MarkdownBlockExecution {
  return MARKDOWN_RICH_BLOCK_EXECUTION;
}

function deferred(reason: MarkdownBudgetReason): MarkdownBlockExecution {
  return { mode: "deferred", budgetVersion: MARKDOWN_RENDER_BUDGET_VERSION, reason };
}

function visibleSource(reason: MarkdownBudgetReason): MarkdownBlockExecution {
  return { mode: "visibleSource", budgetVersion: MARKDOWN_RENDER_BUDGET_VERSION, reason };
}

function countLines(value: string): number {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}
