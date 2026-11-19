import { getMarkdownBlockRhythm, type MarkdownLineRhythm } from "../presentation/markdownBlockRhythm";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { MarkdownAssetUrlResolver, MarkdownHtmlTrustMode, MarkdownLinkGraph } from "../../../registry/viewerTypes";
import {
  markdownFeatureCompositionFacet,
  type MarkdownFeatureComposition,
} from "../features/markdownFeatureContract";
import { getMarkdownPlansInRange, type IndexedMarkdownPlan } from "../plans/markdownPlanIndex";
import type { MarkdownBlockAtomPlan } from "../plans/markdownPlanTypes";
import type { MarkdownTaskLine } from "../syntax/markdownListStructure";
import type { ComposingBlockLine } from "../state/composingBlockLine";
import type { MarkdownRevealedSourceRange } from "../state/revealedSource";
import { HorizontalRuleWidget, TaskCheckboxWidget } from "../widgets/inlineWidgets";
import {
  addReplacementDecoration,
  addSourceSyntaxDecoration,
  type InlineRevealRange,
  type MarkdownDecorationBuilders,
} from "./decorationPrimitives";
import { addInlineMarkdownDecorations } from "./inlineDecorations";

const markdownDecorationDiagnostics = {
  rangeBuilds: 0,
  linesScanned: 0,
  fullDocumentScans: 0,
};

export function addMarkdownBlockAndLineDecorations(
  state: EditorState,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  revealedSourceRange: MarkdownRevealedSourceRange | null,
  composingLine: ComposingBlockLine | null,
  htmlTrustMode: MarkdownHtmlTrustMode,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
  from = 0,
  to = state.doc.length,
) {
  const rangeFrom = Math.max(0, Math.min(from, to, state.doc.length));
  const rangeTo = Math.max(rangeFrom, Math.min(Math.max(from, to), state.doc.length));
  const firstLine = state.doc.lineAt(rangeFrom);
  const lastLine = state.doc.lineAt(rangeTo);
  const plans = getMarkdownPlansInRange(state, firstLine.from, lastLine.to);
  const planLookup = createLinePlanLookup(state, plans);
  const rhythm = getMarkdownBlockRhythm(state, firstLine.from, lastLine.to, composingLine?.from);
  const featureComposition = state.facet(markdownFeatureCompositionFacet);
  markdownDecorationDiagnostics.rangeBuilds += 1;
  markdownDecorationDiagnostics.linesScanned += lastLine.number - firstLine.number + 1;
  if (firstLine.from === 0 && lastLine.to === state.doc.length) {
    markdownDecorationDiagnostics.fullDocumentScans += 1;
  }

  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number;) {
    const line = state.doc.line(lineNumber);
    const explicitlyRevealedBlockLine = (
      revealedSourceRange?.presentation === "block"
      && line.from <= revealedSourceRange.to
      && line.to >= revealedSourceRange.from
    );
    if (composingLine?.from === line.from || explicitlyRevealedBlockLine) {
      addMarkdownSourceLineDecorations(line.from, rhythm.get(line.from), builders);
      lineNumber += 1;
      continue;
    }

    const blockPlan = planLookup.blockAtomsByLineFrom.get(line.from) ?? null;
    if (blockPlan) {
      const widget = blockPlan.embed.kind === "horizontalRule"
        ? new HorizontalRuleWidget(blockPlan.layout.estimatedHeight)
        : featureComposition?.createBlockWidget(blockPlan, {
            htmlTrustMode,
            markdownLinkGraph,
            documentPath,
            markdownAssetUrlResolver,
          }) ?? null;
      if (widget) {
        addReplacementDecoration(
          builders,
          Decoration.replace({
            widget,
            block: true,
          }),
          blockPlan.sourceRange.from,
          blockPlan.sourceRange.to,
        );
        const lastCovered = Math.min(
          Math.max(blockPlan.sourceRange.to - 1, blockPlan.sourceRange.from),
          state.doc.length,
        );
        lineNumber = state.doc.lineAt(lastCovered).number + 1;
        continue;
      }
    }

    decorateMarkdownLine(
      state,
      line.from,
      line.to,
      line.text,
      builders,
      inlineRevealRange,
      revealedSourceRange,
      htmlTrustMode,
      markdownLinkGraph,
      documentPath,
      markdownAssetUrlResolver,
      planLookup.plansByLineFrom.get(line.from) ?? EMPTY_INDEXED_PLANS,
      rhythm.get(line.from),
    );
    lineNumber += 1;
  }
}

function addMarkdownSourceLineDecorations(
  lineFrom: number,
  lineRhythm: MarkdownLineRhythm | undefined,
  builders: MarkdownDecorationBuilders,
) {
  // Source visibility changes the representation, not list ownership.
  // Keep the parent rail and expose one literal marker while typing.
  const list = lineRhythm?.list;
  builders.decorations.push(
    Decoration.line({
      class: list ? [...lineRhythm.classes].filter(name => !name.startsWith("cm-md-task-")).concat("cm-md-source-line", "cm-md-list-source-line").join(" ") : "cm-md-source-line",
      attributes: getMarkdownLineAttributes(lineRhythm),
    }).range(lineFrom),
  );
  if (list && list.sourceIndentTo > lineFrom) {
    addSourceSyntaxDecoration(builders, lineFrom, list.sourceIndentTo, "list", false);
  }
}

const EMPTY_INDEXED_PLANS: readonly IndexedMarkdownPlan[] = [];

function createLinePlanLookup(
  state: EditorState,
  plans: readonly IndexedMarkdownPlan[],
): {
  blockAtomsByLineFrom: ReadonlyMap<number, MarkdownBlockAtomPlan>;
  plansByLineFrom: ReadonlyMap<number, readonly IndexedMarkdownPlan[]>;
} {
  const blockAtomsByLineFrom = new Map<number, MarkdownBlockAtomPlan>();
  const plansByLineFrom = new Map<number, IndexedMarkdownPlan[]>();
  for (const entry of plans) {
    if (entry.plan.presentation === "blockAtom") {
      blockAtomsByLineFrom.set(entry.plan.sourceRange.from, entry.plan);
      continue;
    }
    const lineFrom = state.doc.lineAt(entry.plan.sourceRange.from).from;
    const linePlans = plansByLineFrom.get(lineFrom);
    if (linePlans) linePlans.push(entry);
    else plansByLineFrom.set(lineFrom, [entry]);
  }
  return { blockAtomsByLineFrom, plansByLineFrom };
}

function decorateMarkdownLine(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  revealedSourceRange: MarkdownRevealedSourceRange | null,
  htmlTrustMode: MarkdownHtmlTrustMode,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
  plans: readonly IndexedMarkdownPlan[],
  rhythm?: MarkdownLineRhythm,
) {
  const taskLine = findTaskCheckboxLine(plans, lineFrom, lineTo);
  const lineClasses = getMarkdownLineClasses(
    text,
    state.facet(markdownFeatureCompositionFacet),
  );
  const classes = [...new Set([...lineClasses.split(" ").filter(Boolean), ...(rhythm?.classes ?? [])])].join(" ");
  if (classes) {
    builders.decorations.push(
      Decoration.line({
        class: classes,
        attributes: getMarkdownLineAttributes(rhythm),
      }).range(lineFrom),
    );
  }

  const headingMatch = /^(#{1,6})(\s|$)/.exec(text);
  if (headingMatch) {
    addSourceSyntaxDecoration(builders, lineFrom, lineFrom + headingMatch[0].length, "heading", false);
  }

  const blockquoteMarker = /^(\s*>+\s?)/.exec(text);
  if (blockquoteMarker) {
    addSourceSyntaxDecoration(builders, lineFrom, lineFrom + blockquoteMarker[1].length, "blockquote", false);
  }

  if (taskLine) {
    addSourceSyntaxDecoration(builders, taskLine.prefixFrom, taskLine.prefixTo, "task", false);
    builders.decorations.push(
      Decoration.widget({
        widget: new TaskCheckboxWidget(taskLine),
        side: -1,
      }).range(taskLine.prefixTo),
    );
    addInlineMarkdownDecorations(
      state,
      lineFrom,
      text,
      builders,
      inlineRevealRange,
      revealedSourceRange,
      htmlTrustMode,
      markdownLinkGraph,
      documentPath,
      markdownAssetUrlResolver,
      plans,
      [{ from: taskLine.prefixFrom, to: taskLine.prefixTo }],
    );
    return;
  }

  if (rhythm?.list && rhythm.list.prefixTo > lineFrom) {
    addSourceSyntaxDecoration(builders, lineFrom, rhythm.list.prefixTo, "list", false);
  }

  addInlineMarkdownDecorations(
    state,
    lineFrom,
    text,
    builders,
    inlineRevealRange,
    revealedSourceRange,
    htmlTrustMode,
    markdownLinkGraph,
    documentPath,
    markdownAssetUrlResolver,
    plans,
  );
}

function findTaskCheckboxLine(
  plans: readonly IndexedMarkdownPlan[],
  lineFrom: number,
  lineTo: number,
): MarkdownTaskLine | null {
  for (const { element, plan } of plans) {
    if (plan.sourceRange.from >= lineTo || plan.sourceRange.to <= lineFrom) continue;
    if (element.kind !== "task") continue;
    if (plan.presentation !== "inlineAtom" || plan.atom.kind !== "taskCheckbox") continue;
    return element.blockData.task;
  }
  return null;
}

export function resetMarkdownDecorationDiagnostics() {
  markdownDecorationDiagnostics.rangeBuilds = 0;
  markdownDecorationDiagnostics.linesScanned = 0;
  markdownDecorationDiagnostics.fullDocumentScans = 0;
}

export function getMarkdownDecorationDiagnostics() {
  return { ...markdownDecorationDiagnostics };
}

function getMarkdownLineAttributes(
  rhythm?: MarkdownLineRhythm,
): Record<string, string> | undefined {
  if (rhythm?.list) {
    const { depth, marker, columns, parentColumns } = rhythm.list;
    const width = (count: number) => count === 0
      ? "var(--po-md-list-marker-width)"
      : `max(var(--po-md-list-marker-width), calc(${count - 1} * 1ch + var(--po-md-ordered-marker-suffix-width)))`;
    // Source-derived ancestor widths; every spacing value remains file-owned.
    const parentPrefix = parentColumns.length ? `--md-list-parent-prefix-width:calc(var(--po-md-list-inset) + ${width(parentColumns[0])} + var(--po-md-list-marker-gap)${parentColumns.slice(1).map(count => ` + max(var(--po-md-list-indent-step), calc(${width(count)} + var(--po-md-list-marker-gap)))`).join("")});` : "";
    return { style: `--md-list-depth:${depth};--md-list-marker:${cssString(marker)};--md-list-marker-columns:${columns};${parentPrefix}` };
  }
  return undefined;
}

function cssString(value: string): string {
  return JSON.stringify(value);
}

function getMarkdownLineClasses(
  text: string,
  featureComposition: MarkdownFeatureComposition | null,
): string {
  const classes: string[] = [];

  const headingMatch = /^(#{1,6})(?:\s|$)/.exec(text);
  if (headingMatch) {
    classes.push("cm-md-heading", `cm-md-heading-${headingMatch[1].length}`);
  }

  if (/^\s*>/.test(text)) classes.push("cm-md-blockquote");
  if (/^\s*(`{3,}|~{3,})/.test(text)) classes.push("cm-md-code-fence");
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) classes.push("cm-md-hr");
  if (featureComposition) classes.push(...featureComposition.getLineClasses(text));

  return classes.join(" ");
}
